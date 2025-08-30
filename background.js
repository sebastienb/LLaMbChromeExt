// Background service worker for LlamB Chrome Extension

// Extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('LlamB Chat Assistant installed');
  
  // Set default settings
  chrome.storage.sync.set({
    sidebarEnabled: true,
    apiKey: '',
    selectedModel: 'gpt-3.5-turbo',
    autoContextCapture: true
  });
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
      }, 100);
    } catch (injectionError) {
      console.log('Could not inject content script:', injectionError);
    }
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getPageContext':
      handleGetPageContext(sender.tab.id, sendResponse);
      return true; // Will respond asynchronously
      
    case 'sendChatMessage':
      handleChatMessage(request.message, request.context, sendResponse);
      return true; // Will respond asynchronously
      
    case 'getSettings':
      handleGetSettings(sendResponse);
      return true;
      
    case 'updateSettings':
      handleUpdateSettings(request.settings, sendResponse);
      return true;
      
    default:
      console.log('Unknown action:', request.action);
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

// Handle chat messages (placeholder for LLM integration)
async function handleChatMessage(message, context, sendResponse) {
  try {
    // Get settings
    const settings = await chrome.storage.sync.get(['apiKey', 'selectedModel']);
    
    // Placeholder response - will be replaced with actual LLM API call
    const response = {
      success: true,
      response: `I received your message: "${message}"\n\nPage context:\n- URL: ${context.url}\n- Title: ${context.title}\n- Selected text: ${context.selectedText || 'None'}\n\nLLM integration coming soon! Current model setting: ${settings.selectedModel || 'Not configured'}`
    };
    
    // Simulate API delay
    setTimeout(() => {
      sendResponse(response);
    }, 1000);
    
  } catch (error) {
    console.log('Error handling chat message:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get extension settings
async function handleGetSettings(sendResponse) {
  try {
    const settings = await chrome.storage.sync.get([
      'sidebarEnabled',
      'apiKey',
      'selectedModel',
      'autoContextCapture'
    ]);
    
    sendResponse({ success: true, settings });
  } catch (error) {
    console.log('Error getting settings:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Update extension settings
async function handleUpdateSettings(newSettings, sendResponse) {
  try {
    await chrome.storage.sync.set(newSettings);
    sendResponse({ success: true });
  } catch (error) {
    console.log('Error updating settings:', error);
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

// Keyboard shortcut support (can be added to manifest later)
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'toggle-sidebar') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
    }
  }
});

console.log('LlamB Background Script Loaded');