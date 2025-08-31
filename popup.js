// Popup script for LlamB Chrome Extension
document.addEventListener('DOMContentLoaded', async () => {
  
  // Detect if we're running in a popup window vs extension popup
  const isStandaloneWindow = window.location.href.includes('popup.html') && !chrome.extension.getViews({ type: 'popup' }).includes(window);
  
  // Initialize storage manager
  const storageManager = new StorageManager();
  
  // Get DOM elements
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  const connectionSelect = document.getElementById('connection-select');
  const manageConnectionsBtn = document.getElementById('manage-connections-btn');
  const connectionStatus = document.getElementById('connection-status');
  const customizeActionsBtn = document.getElementById('customize-actions-btn');
  const quickActionsContainer = document.getElementById('quick-actions-container');

  // Load connections, settings and quick actions
  loadConnections();
  loadQuickActions();

  // Event listeners
  toggleSidebarBtn.addEventListener('click', toggleSidebar);
  connectionSelect.addEventListener('change', changeActiveConnection);
  manageConnectionsBtn.addEventListener('click', openSettings);
  customizeActionsBtn.addEventListener('click', openActionsManager);
  
  // Quick actions modal event listeners
  setupActionsModalListeners();

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
      if (!isStandaloneWindow) {
        window.close();
      }
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
          if (!isStandaloneWindow) {
            window.close(); // Close popup after successful action
          } else {
            showNotification('Sidebar toggled successfully');
          }
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
              if (!isStandaloneWindow) {
                window.close();
              } else {
                showNotification('Sidebar toggled successfully');
              }
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

  // Load and display quick actions
  async function loadQuickActions() {
    try {
      const quickActions = await storageManager.getQuickActions();
      renderQuickActions(quickActions);
    } catch (error) {
      console.error('Error loading quick actions:', error);
      showNotification('Failed to load quick actions');
    }
  }

  // Render quick actions buttons
  function renderQuickActions(actions) {
    quickActionsContainer.innerHTML = '';
    
    actions.forEach(action => {
      const button = document.createElement('button');
      button.className = 'llamb-btn llamb-btn-full';
      button.innerHTML = `${action.icon} ${action.label}`;
      button.addEventListener('click', () => executeQuickAction(action));
      quickActionsContainer.appendChild(button);
    });
  }

  // Execute a quick action
  async function executeQuickAction(action) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        showNotification('No active tab found');
        return;
      }

      let prompt = action.prompt;
      
      // If action uses page context, get it and replace variables
      if (action.usePageContext) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageContext' });
          
          // Replace template variables
          prompt = prompt
            .replace(/{pageTitle}/g, response.title || 'Unknown Title')
            .replace(/{pageUrl}/g, response.url || 'Unknown URL')
            .replace(/{pageContent}/g, response.content || 'No content available')
            .replace(/{selectedText}/g, response.selectedText || 'No text selected');
        } catch (error) {
          console.log('Could not get page context:', error);
          showNotification('Could not get page context. Try refreshing the page.');
          return;
        }
      }

      // Toggle sidebar and send message
      await chrome.tabs.sendMessage(tab.id, { action: 'toggleSidebar' });
      
      // Send the prompt
      setTimeout(async () => {
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'addMessage',
          message: prompt,
          sender: 'user'
        });
      }, 500);
      
      if (!isStandaloneWindow) {
        window.close();
      }
    } catch (error) {
      console.error('Error executing quick action:', error);
      showNotification('Could not execute action. Try refreshing the page.');
    }
  }

  // Open actions manager modal
  function openActionsManager() {
    document.getElementById('actions-modal').classList.add('active');
    loadActionsForManager();
  }

  // Load actions for the manager
  async function loadActionsForManager() {
    try {
      const quickActions = await storageManager.getQuickActions();
      renderActionsManager(quickActions);
    } catch (error) {
      console.error('Error loading actions for manager:', error);
      showNotification('Failed to load actions');
    }
  }

  // Render actions in the manager
  function renderActionsManager(actions) {
    const actionsList = document.getElementById('actions-list');
    actionsList.innerHTML = '';
    
    actions.forEach(action => {
      const actionItem = document.createElement('div');
      actionItem.className = 'llamb-action-item';
      actionItem.innerHTML = `
        <div class="llamb-action-info">
          <span class="llamb-action-icon">${action.icon}</span>
          <div class="llamb-action-details">
            <div class="llamb-action-label">${action.label}</div>
            <div class="llamb-action-preview">${truncateText(action.prompt, 60)}</div>
          </div>
        </div>
        <div class="llamb-action-controls">
          <button class="llamb-btn llamb-btn-sm" onclick="editAction('${action.id}')">✏️</button>
          <button class="llamb-btn llamb-btn-sm btn-danger" onclick="deleteAction('${action.id}')" ${action.isDefault ? 'title="Cannot delete default action"' : ''}>🗑️</button>
        </div>
      `;
      
      // Disable delete button for default actions
      if (action.isDefault) {
        const deleteBtn = actionItem.querySelector('.btn-danger');
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.5';
      }
      
      actionsList.appendChild(actionItem);
    });
  }

  // Setup modal event listeners
  function setupActionsModalListeners() {
    // Close modal listeners
    document.getElementById('close-actions-modal').addEventListener('click', () => {
      document.getElementById('actions-modal').classList.remove('active');
    });
    
    document.getElementById('close-editor-modal').addEventListener('click', () => {
      document.getElementById('action-editor-modal').classList.remove('active');
    });
    
    // Toolbar button listeners
    document.getElementById('add-action-btn').addEventListener('click', () => {
      openActionEditor();
    });
    
    document.getElementById('restore-defaults-btn').addEventListener('click', async () => {
      if (confirm('This will restore all default actions. Continue?')) {
        try {
          await storageManager.resetQuickActionsToDefault();
          loadActionsForManager();
          loadQuickActions();
          showNotification('Default actions restored');
        } catch (error) {
          console.error('Error restoring defaults:', error);
          showNotification('Failed to restore defaults');
        }
      }
    });
    
    // Form submission
    document.getElementById('action-editor-form').addEventListener('submit', saveAction);
    
    document.getElementById('cancel-editor-btn').addEventListener('click', () => {
      document.getElementById('action-editor-modal').classList.remove('active');
    });
    
    // Close modals when clicking overlay
    document.getElementById('actions-modal').addEventListener('click', (e) => {
      if (e.target.id === 'actions-modal') {
        document.getElementById('actions-modal').classList.remove('active');
      }
    });
    
    document.getElementById('action-editor-modal').addEventListener('click', (e) => {
      if (e.target.id === 'action-editor-modal') {
        document.getElementById('action-editor-modal').classList.remove('active');
      }
    });
  }

  // Open action editor
  function openActionEditor(actionId = null) {
    const modal = document.getElementById('action-editor-modal');
    const title = document.getElementById('editor-modal-title');
    const form = document.getElementById('action-editor-form');
    
    form.dataset.actionId = actionId || '';
    
    if (actionId) {
      title.textContent = 'Edit Action';
      loadActionForEditing(actionId);
    } else {
      title.textContent = 'Add New Action';
      form.reset();
      document.getElementById('action-use-context').checked = true;
    }
    
    modal.classList.add('active');
  }

  // Load action for editing
  async function loadActionForEditing(actionId) {
    try {
      const quickActions = await storageManager.getQuickActions();
      const action = quickActions.find(a => a.id === actionId);
      
      if (action) {
        document.getElementById('action-label').value = action.label;
        document.getElementById('action-icon').value = action.icon;
        document.getElementById('action-prompt').value = action.prompt;
        document.getElementById('action-use-context').checked = action.usePageContext;
      }
    } catch (error) {
      console.error('Error loading action for editing:', error);
      showNotification('Failed to load action');
    }
  }

  // Save action
  async function saveAction(e) {
    e.preventDefault();
    
    const form = e.target;
    const actionId = form.dataset.actionId;
    
    const actionData = {
      label: document.getElementById('action-label').value.trim(),
      icon: document.getElementById('action-icon').value.trim() || '⚡',
      prompt: document.getElementById('action-prompt').value.trim(),
      usePageContext: document.getElementById('action-use-context').checked
    };
    
    if (!actionData.label || !actionData.prompt) {
      showNotification('Please fill in all required fields');
      return;
    }
    
    try {
      if (actionId) {
        await storageManager.updateQuickAction(actionId, actionData);
        showNotification('Action updated successfully');
      } else {
        await storageManager.addQuickAction(actionData);
        showNotification('Action added successfully');
      }
      
      document.getElementById('action-editor-modal').classList.remove('active');
      loadActionsForManager();
      loadQuickActions();
    } catch (error) {
      console.error('Error saving action:', error);
      showNotification('Failed to save action');
    }
  }

  // Global functions for inline event handlers
  window.editAction = function(actionId) {
    openActionEditor(actionId);
  };
  
  window.deleteAction = async function(actionId) {
    if (confirm('Are you sure you want to delete this action?')) {
      try {
        await storageManager.deleteQuickAction(actionId);
        loadActionsForManager();
        loadQuickActions();
        showNotification('Action deleted');
      } catch (error) {
        console.error('Error deleting action:', error);
        showNotification('Failed to delete action');
      }
    }
  };

  // Utility function to truncate text
  function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
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