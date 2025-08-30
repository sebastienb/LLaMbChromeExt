// Background service worker for LlamB Chrome Extension

// Import LLM management modules
importScripts(
  'js/storage-manager.js',
  'js/stream-parser.js', 
  'js/llm-providers.js',
  'js/llm-manager.js'
);

// Initialize LLM Manager
let llmManager;

// Extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('LlamB Chat Assistant installed');
  
  // Initialize LLM Manager
  llmManager = new LLMManager();
  await llmManager.initialize();
  
  // Migrate old settings if they exist
  try {
    const oldSettings = await chrome.storage.sync.get([
      'sidebarEnabled', 'apiKey', 'selectedModel', 'autoContextCapture'
    ]);
    
    if (oldSettings.apiKey) {
      // Create a connection from old settings
      await llmManager.addConnection({
        name: 'Migrated Connection',
        type: 'openai',
        endpoint: 'https://api.openai.com/v1',
        apiKey: oldSettings.apiKey,
        model: oldSettings.selectedModel || 'gpt-3.5-turbo',
        enabled: true
      });
      
      // Clear old settings
      await chrome.storage.sync.clear();
      console.log('LlamB: Migrated old settings to new format');
    }
  } catch (error) {
    console.log('LlamB: No old settings to migrate');
  }
});

// Initialize LLM Manager on startup
chrome.runtime.onStartup.addListener(async () => {
  if (!llmManager) {
    llmManager = new LLMManager();
    await llmManager.initialize();
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Toggle sidebar in the active tab
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
  } catch (error) {
    console.log('Could not inject sidebar:', error);
    
    // Try to inject content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      // Try again after injection
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
        } catch (e) {
          console.log('Still could not toggle sidebar:', e);
        }
      }, 200);
    } catch (injectionError) {
      console.log('Could not inject content script:', injectionError);
    }
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background: Received message:', request.action);
  
  switch (request.action) {
    case 'getPageContext':
      handleGetPageContext(sender.tab.id, sendResponse);
      return true;
      
    case 'sendChatMessage':
      handleChatMessage(request, sender, sendResponse);
      return true;
      
    case 'getLLMConnections':
      handleGetConnections(sendResponse);
      return true;
      
    case 'setActiveConnection':
      handleSetActiveConnection(request.connectionId, sendResponse);
      return true;
      
    case 'testConnection':
      handleTestConnection(request.connectionData, sendResponse);
      return true;
      
    case 'openSettings':
      handleOpenSettings(sendResponse);
      return true;
      
    default:
      console.log('Background: Unknown action:', request.action);
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

// Get page context from active tab
async function handleGetPageContext(tabId, sendResponse) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'getPageContext' });
    sendResponse({ success: true, context: response });
  } catch (error) {
    console.log('Error getting page context:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle chat messages with LLM
async function handleChatMessage(request, sender, sendResponse) {
  try {
    if (!llmManager) {
      llmManager = new LLMManager();
      await llmManager.initialize();
    }

    const { message, pageContext, options = {} } = request;
    
    console.log('Background: Processing chat message:', message);
    
    // Send the message and get the result
    const result = await llmManager.sendMessage(message, pageContext, options);
    
    console.log('Background: LLM result:', result);
    
    // Set up streaming event listeners AFTER getting the requestId
    const requestId = result.requestId;
    
    // Handle streaming responses
    if (options.streaming !== false && result.type === 'streaming') {
      console.log('Background: Setting up streaming listeners for requestId:', requestId);
      
      const streamChunkHandler = (data) => {
        console.log('Background: Stream chunk received:', data);
        if (data.requestId === requestId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'streamChunk',
            requestId: data.requestId,
            content: data.content,
            blocks: data.blocks,
            fullContent: data.fullContent
          }).catch((error) => {
            console.log('Background: Failed to send stream chunk:', error);
          });
        }
      };
      
      const streamEndHandler = (data) => {
        console.log('Background: Stream end received:', data);
        if (data.requestId === requestId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'streamEnd',
            requestId: data.requestId,
            fullContent: data.fullContent,
            blocks: data.blocks
          }).catch((error) => {
            console.log('Background: Failed to send stream end:', error);
          });
          
          // Clean up event listeners
          llmManager.off('streamChunk', streamChunkHandler);
          llmManager.off('streamEnd', streamEndHandler);
          llmManager.off('streamError', streamErrorHandler);
        }
      };
      
      const streamErrorHandler = (data) => {
        console.log('Background: Stream error received:', data);
        if (data.requestId === requestId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'streamError',
            requestId: data.requestId,
            error: data.error
          }).catch((error) => {
            console.log('Background: Failed to send stream error:', error);
          });
          
          // Clean up event listeners
          llmManager.off('streamChunk', streamChunkHandler);
          llmManager.off('streamEnd', streamEndHandler);
          llmManager.off('streamError', streamErrorHandler);
        }
      };
      
      // Add event listeners
      llmManager.on('streamChunk', streamChunkHandler);
      llmManager.on('streamEnd', streamEndHandler);
      llmManager.on('streamError', streamErrorHandler);
    }
    
    sendResponse({ 
      success: true, 
      requestId: result.requestId,
      type: result.type
    });
    
  } catch (error) {
    console.error('Error handling chat message:', error);
    sendResponse({ 
      success: false, 
      error: error.message,
      details: error.stack 
    });
  }
}

// Get available connections
async function handleGetConnections(sendResponse) {
  try {
    if (!llmManager) {
      llmManager = new LLMManager();
      await llmManager.initialize();
    }
    
    const connections = await llmManager.getConnections();
    const activeConnection = await llmManager.getActiveConnection();
    
    sendResponse({
      success: true,
      connections,
      activeConnectionId: activeConnection?.id || null
    });
  } catch (error) {
    console.error('Error getting connections:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Set active connection
async function handleSetActiveConnection(connectionId, sendResponse) {
  try {
    if (!llmManager) {
      llmManager = new LLMManager();
      await llmManager.initialize();
    }
    
    const connection = await llmManager.setActiveConnection(connectionId);
    sendResponse({ success: true, connection });
  } catch (error) {
    console.error('Error setting active connection:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Test connection
async function handleTestConnection(connectionData, sendResponse) {
  try {
    if (!llmManager) {
      llmManager = new LLMManager();
      await llmManager.initialize();
    }
    
    const result = await llmManager.testConnection(connectionData);
    sendResponse({ success: true, result });
  } catch (error) {
    console.error('Error testing connection:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Open settings page
async function handleOpenSettings(sendResponse) {
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL('settings.html')
    });
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error opening settings:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle tab updates to refresh context
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Notify content script of page change
    chrome.tabs.sendMessage(tabId, { 
      action: 'pageUpdated',
      url: tab.url,
      title: tab.title 
    }).catch(() => {
      // Content script might not be injected yet, ignore error
    });
  }
});

// Keyboard shortcut support
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'toggle-sidebar') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
    }
  } else if (command === 'open-settings') {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }
});

console.log('LlamB Background Script Loaded with LLM Integration');