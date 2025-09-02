// Background service worker for LlamB Chrome Extension

// Import LLM management modules
try {
  importScripts(
    'js/storage-manager.js',
    'js/chat-manager.js',
    'js/stream-parser.js', 
    'js/llm-providers.js',
    'js/llm-manager.js'
  );
  
  console.log('Background: importScripts completed');
  console.log('Background: StorageManager available?', typeof StorageManager);
  console.log('Background: ChatManager available?', typeof ChatManager);
  console.log('Background: LLMManager available?', typeof LLMManager);
} catch (error) {
  console.error('Background: Error importing scripts:', error);
}

// Initialize managers
let llmManager;
let chatManager;

// Extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('LlamB Chat Assistant installed');
  
  // Initialize managers
  llmManager = new LLMManager();
  await llmManager.initialize();
  
  chatManager = new ChatManager();
  
  // Create context menu items
  chrome.contextMenus.create({
    id: "toggle-sidebar",
    title: "Toggle Chat Sidebar",
    contexts: ["all"]
  });
  
  chrome.contextMenus.create({
    id: "settings", 
    title: "Settings",
    contexts: ["all"]
  });
  
  chrome.contextMenus.create({
    id: "manage-connections",
    title: "Manage Connections", 
    contexts: ["all"]
  });
  
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

// Initialize managers on startup
chrome.runtime.onStartup.addListener(async () => {
  if (!llmManager) {
    llmManager = new LLMManager();
    await llmManager.initialize();
  }
  if (!chatManager) {
    chatManager = new ChatManager();
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    switch(info.menuItemId) {
      case "toggle-sidebar":
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
        break;
        
      case "settings":
        // Open popup.html in a new popup window, sized appropriately
        await chrome.windows.create({
          url: chrome.runtime.getURL('popup.html'),
          type: 'popup',
          width: 800,   // Larger width to show content properly
          height: 700   // Increased height for better content display
        });
        break;
        
      case "manage-connections":
        await chrome.tabs.create({
          url: chrome.runtime.getURL('settings.html')
        });
        break;
    }
  } catch (error) {
    console.log('Context menu action failed:', error);
    
    // For toggle-sidebar, try to inject content script if needed
    if (info.menuItemId === "toggle-sidebar") {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        
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
  console.log('Background: Full request object:', request);
  console.log('Background: Sender:', sender);
  
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
      
    case 'getCurrentTab':
      handleGetCurrentTab(sendResponse);
      return true;
      
    case 'getChatHistory':
      handleGetChatHistory(sendResponse);
      return true;
      
    case 'loadChat':
      handleLoadChat(request.chatId, sendResponse);
      return true;
      
    case 'deleteChat':
      handleDeleteChat(request.chatId, sendResponse);
      return true;
      
    case 'exportChat':
      handleExportChat(request.chatId, sendResponse);
      return true;
      
    case 'fetchYoutubeCaptions':
      console.log('Background: Handling fetchYoutubeCaptions request:', request.captionUrl);
      handleFetchYoutubeCaptions(request.captionUrl, sendResponse);
      return true;
      
    case 'getAvailablePlugins':
      handleGetAvailablePlugins(sendResponse);
      return true;
      
    case 'enablePlugin':
      handleEnablePlugin(request.pluginId, sendResponse);
      return true;
      
    case 'disablePlugin':
      handleDisablePlugin(request.pluginId, sendResponse);
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

// Get current active tab
async function handleGetCurrentTab(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    sendResponse({ success: true, tab });
  } catch (error) {
    console.error('Error getting current tab:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get chat history
async function handleGetChatHistory(sendResponse) {
  try {
    console.log('Background: handleGetChatHistory called');
    console.log('Background: ChatManager class available?', typeof ChatManager);
    console.log('Background: Current chatManager instance?', !!chatManager);
    
    // Always ensure ChatManager is initialized
    if (!chatManager) {
      console.log('Background: Initializing ChatManager for getChatHistory');
      if (typeof ChatManager === 'undefined') {
        console.log('Background: ChatManager not found, attempting to reload scripts...');
        try {
          importScripts('js/chat-manager.js');
          console.log('Background: Reloaded chat-manager.js, ChatManager available?', typeof ChatManager);
        } catch (importError) {
          console.error('Background: Failed to reload chat-manager.js:', importError);
          throw new Error('ChatManager class not available - script import failed');
        }
      }
      
      if (typeof ChatManager === 'undefined') {
        throw new Error('ChatManager class still not available after import attempt');
      }
      
      chatManager = new ChatManager();
      console.log('Background: ChatManager initialized successfully');
    }
    
    const chatHistory = await chatManager.getChatHistory();
    console.log('Background: Retrieved chat history:', chatHistory.length, 'chats');
    sendResponse({ success: true, chatHistory });
  } catch (error) {
    console.error('Background: Error getting chat history:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Load specific chat
async function handleLoadChat(chatId, sendResponse) {
  try {
    // Always ensure ChatManager is initialized
    if (!chatManager) {
      console.log('Background: Initializing ChatManager for loadChat');
      chatManager = new ChatManager();
    }
    
    const chat = await chatManager.loadChat(chatId);
    console.log('Background: Loaded chat:', chatId, chat ? 'success' : 'not found');
    sendResponse({ success: true, chat });
  } catch (error) {
    console.error('Background: Error loading chat:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Delete chat
async function handleDeleteChat(chatId, sendResponse) {
  try {
    // Always ensure ChatManager is initialized
    if (!chatManager) {
      console.log('Background: Initializing ChatManager for deleteChat');
      chatManager = new ChatManager();
    }
    
    const result = await chatManager.deleteChat(chatId);
    console.log('Background: Deleted chat:', chatId, result ? 'success' : 'failed');
    sendResponse({ success: result });
  } catch (error) {
    console.error('Background: Error deleting chat:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Export chat as markdown
async function handleExportChat(chatId, sendResponse) {
  try {
    // Always ensure ChatManager is initialized
    if (!chatManager) {
      console.log('Background: Initializing ChatManager for exportChat');
      chatManager = new ChatManager();
    }
    
    const markdown = await chatManager.exportChatAsMarkdown(chatId);
    console.log('Background: Exported chat:', chatId, markdown ? 'success' : 'failed');
    sendResponse({ success: true, markdown });
  } catch (error) {
    console.error('Background: Error exporting chat:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Fetch YouTube captions from background context to bypass CORS
async function handleFetchYoutubeCaptions(captionUrl, sendResponse) {
  try {
    console.log('Background: Fetching YouTube captions from:', captionUrl);
    
    const response = await fetch(captionUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    console.log('Background: Caption fetch response status:', response.status);
    console.log('Background: Response headers:', [...response.headers.entries()]);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log('Background: Raw response text length:', text.length);
    console.log('Background: Raw response sample:', text.substring(0, 200));
    
    if (!text.trim()) {
      throw new Error('Empty response from caption API');
    }
    
    try {
      const captionData = JSON.parse(text);
      console.log('Background: Successfully parsed caption JSON, events:', captionData.events?.length || 'No events');
      sendResponse({ 
        success: true, 
        data: captionData,
        rawLength: text.length 
      });
    } catch (parseError) {
      console.error('Background: Failed to parse caption response as JSON:', parseError.message);
      sendResponse({ 
        success: false, 
        error: `JSON parse error: ${parseError.message}`,
        rawText: text.substring(0, 500) // Send first 500 chars for debugging
      });
    }
    
  } catch (error) {
    console.error('Background: Error fetching YouTube captions:', error);
    sendResponse({ 
      success: false, 
      error: error.message 
    });
  }
}

// Get available plugins
async function handleGetAvailablePlugins(sendResponse) {
  try {
    // Return the list of hardcoded plugins for now
    // In the future, this could be dynamically discovered
    const plugins = [
      {
        id: 'youtube-captions',
        name: 'YouTube Captions',
        description: 'Extract captions from YouTube videos',
        version: '1.0.0',
        icon: '💬',
        matches: ['*://www.youtube.com/watch*', '*://youtube.com/watch*'],
        permissions: ['extractContent']
      }
    ];
    
    sendResponse({ success: true, plugins });
  } catch (error) {
    console.error('Background: Error getting available plugins:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Enable a plugin
async function handleEnablePlugin(pluginId, sendResponse) {
  try {
    console.log('Background: Enabling plugin:', pluginId);
    
    // Get current plugin settings
    const result = await chrome.storage.local.get('llamb-plugin-settings');
    const settings = result['llamb-plugin-settings'] || { enabled: [], plugins: {} };
    
    // Add plugin to enabled list if not already there
    if (!settings.enabled.includes(pluginId)) {
      settings.enabled.push(pluginId);
    }
    
    // Save updated settings
    await chrome.storage.local.set({ 'llamb-plugin-settings': settings });
    
    // Notify all tabs to update their plugin state
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'pluginStateChanged',
          pluginId: pluginId,
          enabled: true
        });
      } catch (error) {
        // Tab may not have content script, ignore
      }
    }
    
    console.log('Background: Plugin enabled successfully:', pluginId);
    sendResponse({ success: true });
  } catch (error) {
    console.error('Background: Error enabling plugin:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Disable a plugin
async function handleDisablePlugin(pluginId, sendResponse) {
  try {
    console.log('Background: Disabling plugin:', pluginId);
    
    // Get current plugin settings
    const result = await chrome.storage.local.get('llamb-plugin-settings');
    const settings = result['llamb-plugin-settings'] || { enabled: [], plugins: {} };
    
    // Remove plugin from enabled list
    settings.enabled = settings.enabled.filter(id => id !== pluginId);
    
    // Save updated settings
    await chrome.storage.local.set({ 'llamb-plugin-settings': settings });
    
    // Notify all tabs to update their plugin state
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'pluginStateChanged',
          pluginId: pluginId,
          enabled: false
        });
      } catch (error) {
        // Tab may not have content script, ignore
      }
    }
    
    console.log('Background: Plugin disabled successfully:', pluginId);
    sendResponse({ success: true });
  } catch (error) {
    console.error('Background: Error disabling plugin:', error);
    sendResponse({ success: false, error: error.message });
  }
}

console.log('LlamB Background Script Loaded with LLM Integration');