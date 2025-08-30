// Popup script for LlamB Chrome Extension
document.addEventListener('DOMContentLoaded', async () => {
  
  // Get DOM elements
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  const analyzePageBtn = document.getElementById('analyze-page');
  const summarizeSelectionBtn = document.getElementById('summarize-selection');
  const modelSelect = document.getElementById('model-select');
  const apiKeyInput = document.getElementById('api-key');
  const connectionStatus = document.getElementById('connection-status');

  // Load saved settings
  loadSettings();

  // Event listeners
  toggleSidebarBtn.addEventListener('click', toggleSidebar);
  analyzePageBtn.addEventListener('click', analyzePage);
  summarizeSelectionBtn.addEventListener('click', summarizeSelection);
  modelSelect.addEventListener('change', saveSettings);
  apiKeyInput.addEventListener('input', debounce(saveSettings, 500));

  // Load settings from storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'selectedModel',
        'apiKey',
        'sidebarEnabled',
        'autoContextCapture'
      ]);

      if (result.selectedModel) {
        modelSelect.value = result.selectedModel;
      }

      if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
        updateConnectionStatus(true);
      } else {
        updateConnectionStatus(false);
      }

    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  // Save settings to storage
  async function saveSettings() {
    try {
      const settings = {
        selectedModel: modelSelect.value,
        apiKey: apiKeyInput.value,
        sidebarEnabled: true,
        autoContextCapture: true
      };

      await chrome.storage.sync.set(settings);
      
      // Update connection status based on API key
      updateConnectionStatus(!!apiKeyInput.value);
      
      console.log('Settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  // Toggle sidebar in active tab
  async function toggleSidebar() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        showNotification('No active tab found');
        return;
      }

      console.log('LlamB: Attempting to toggle sidebar on tab:', tab.id);
      
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
        console.log('LlamB: Toggle response:', response);
        
        if (response && response.success) {
          window.close(); // Close popup after successful action
        } else {
          throw new Error(response?.error || 'Unknown error');
        }
      } catch (messageError) {
        console.log('LlamB: Content script not responding, trying to inject...');
        
        // Try to inject content script
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        // Wait a moment then try again
        setTimeout(async () => {
          try {
            const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
            console.log('LlamB: Retry response:', retryResponse);
            
            if (retryResponse && retryResponse.success) {
              window.close();
            } else {
              throw new Error('Retry failed');
            }
          } catch (retryError) {
            console.error('LlamB: Retry failed:', retryError);
            showNotification('Could not toggle sidebar. Try refreshing the page.');
          }
        }, 500);
      }
    } catch (error) {
      console.error('LlamB: Error in toggleSidebar:', error);
      showNotification(`Error: ${error.message}`);
    }
  }

  // Analyze current page
  async function analyzePage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab) {
        // Get page context
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContext' });
        
        // Send analysis request to background script
        const analysisPrompt = `Please analyze this webpage:
Title: ${response.title}
URL: ${response.url}
Selected text: ${response.selectedText || 'None'}

Provide a brief summary of the page content and any key insights.`;

        // Toggle sidebar and send message
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
        
        // Send the analysis prompt (this would integrate with LLM later)
        setTimeout(async () => {
          await chrome.tabs.sendMessage(tab.id, { 
            action: 'addMessage',
            message: analysisPrompt,
            sender: 'user'
          });
        }, 500);
        
        window.close();
      }
    } catch (error) {
      console.error('Error analyzing page:', error);
      showNotification('Could not analyze page. Try refreshing the page.');
    }
  }

  // Summarize selected text
  async function summarizeSelection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab) {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContext' });
        
        if (!response.selectedText) {
          showNotification('Please select some text on the page first.');
          return;
        }

        const summaryPrompt = `Please summarize this selected text:

"${response.selectedText}"

Provide a concise summary highlighting the main points.`;

        // Toggle sidebar and send message
        await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
        
        setTimeout(async () => {
          await chrome.tabs.sendMessage(tab.id, { 
            action: 'addMessage',
            message: summaryPrompt,
            sender: 'user'
          });
        }, 500);
        
        window.close();
      }
    } catch (error) {
      console.error('Error summarizing selection:', error);
      showNotification('Could not summarize selection. Try refreshing the page.');
    }
  }

  // Update connection status indicator
  function updateConnectionStatus(connected) {
    const statusText = connectionStatus.querySelector('span');
    
    if (connected) {
      connectionStatus.className = 'status-indicator';
      statusText.textContent = 'API key configured';
    } else {
      connectionStatus.className = 'status-indicator disconnected';
      statusText.textContent = 'API key required';
    }
  }

  // Show notification
  function showNotification(message) {
    // Create temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: #323232;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 3000);
  }

  // Debounce function for input events
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Handle footer link clicks
  document.getElementById('help-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/yourusername/llamb-extension' });
  });

  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    // Could open a full settings page
    showNotification('Advanced settings coming soon!');
  });

  document.getElementById('feedback-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/yourusername/llamb-extension/issues' });
  });

});