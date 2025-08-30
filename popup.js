// Popup script for LlamB Chrome Extension
document.addEventListener('DOMContentLoaded', async () => {
  
  // Get DOM elements
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  const analyzePageBtn = document.getElementById('analyze-page');
  const summarizeSelectionBtn = document.getElementById('summarize-selection');
  const connectionSelect = document.getElementById('connection-select');
  const manageConnectionsBtn = document.getElementById('manage-connections-btn');
  const connectionStatus = document.getElementById('connection-status');

  // Load connections and settings
  loadConnections();

  // Event listeners
  toggleSidebarBtn.addEventListener('click', toggleSidebar);
  analyzePageBtn.addEventListener('click', analyzePage);
  summarizeSelectionBtn.addEventListener('click', summarizeSelection);
  connectionSelect.addEventListener('change', changeActiveConnection);
  manageConnectionsBtn.addEventListener('click', openSettings);

  // Load connections from background
  async function loadConnections() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getLLMConnections' });
      
      if (response.success) {
        populateConnectionSelect(response.connections, response.activeConnectionId);
        updateConnectionStatus(response.connections, response.activeConnectionId);
      } else {
        console.error('Failed to load connections:', response.error);
        updateConnectionStatus([], null);
      }
    } catch (error) {
      console.error('Error loading connections:', error);
      updateConnectionStatus([], null);
    }
  }

  // Populate connection dropdown
  function populateConnectionSelect(connections, activeConnectionId) {
    connectionSelect.innerHTML = '';
    
    if (connections.length === 0) {
      connectionSelect.innerHTML = '<option value="">No connections configured</option>';
      connectionSelect.disabled = true;
      return;
    }

    connectionSelect.disabled = false;
    
    connections.forEach(connection => {
      const option = document.createElement('option');
      option.value = connection.id;
      option.textContent = `${connection.name} (${connection.model})`;
      option.selected = connection.id === activeConnectionId;
      connectionSelect.appendChild(option);
    });
  }

  // Change active connection
  async function changeActiveConnection() {
    const connectionId = connectionSelect.value;
    if (!connectionId) return;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'setActiveConnection',
        connectionId: connectionId
      });

      if (response.success) {
        updateConnectionStatus([response.connection], connectionId);
        showNotification('Active connection updated');
      } else {
        showNotification('Failed to update connection');
      }
    } catch (error) {
      console.error('Error changing active connection:', error);
      showNotification('Error updating connection');
    }
  }

  // Open settings page
  async function openSettings() {
    try {
      await chrome.runtime.sendMessage({ action: 'openSettings' });
      window.close();
    } catch (error) {
      console.error('Error opening settings:', error);
      showNotification('Could not open settings');
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
  function updateConnectionStatus(connections, activeConnectionId) {
    const statusText = connectionStatus.querySelector('span');
    
    if (connections.length === 0) {
      connectionStatus.className = 'status-indicator disconnected';
      statusText.textContent = 'No connections configured';
    } else if (activeConnectionId) {
      const activeConnection = connections.find(c => c.id === activeConnectionId);
      if (activeConnection && activeConnection.enabled) {
        connectionStatus.className = 'status-indicator';
        statusText.textContent = `Connected: ${activeConnection.name}`;
      } else {
        connectionStatus.className = 'status-indicator disconnected';
        statusText.textContent = 'Active connection disabled';
      }
    } else {
      connectionStatus.className = 'status-indicator disconnected';
      statusText.textContent = 'No active connection';
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