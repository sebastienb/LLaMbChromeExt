// Popup script for LlamB Chrome Extension
document.addEventListener('DOMContentLoaded', async () => {
  
  // Detect if we're running in a popup window vs extension popup
  const isStandaloneWindow = window.location.href.includes('popup.html') && !chrome.extension.getViews({ type: 'popup' }).includes(window);
  
  // Initialize storage manager - wait for it to be available
  let storageManager = null;
  
  // Wait for StorageManager to be loaded
  function initStorageManager() {
    try {
      // Check for our custom StorageManager class - try different approaches
      if (typeof window.StorageManager !== 'undefined') {
        storageManager = new window.StorageManager();
        console.log('Window StorageManager initialized successfully');
        return true;
      } else if (typeof StorageManager !== 'undefined') {
        // Check if this is our StorageManager by checking for custom methods
        const testInstance = new StorageManager();
        if (testInstance.storageKey && testInstance.sidebarStateKey) {
          storageManager = testInstance;
          console.log('Custom StorageManager initialized successfully');
          return true;
        }
      }
    } catch (error) {
      console.error('Error initializing StorageManager:', error);
    }
    return false;
  }
  
  // Try to initialize immediately
  if (!initStorageManager()) {
    // If not available, wait for script to load
    setTimeout(() => {
      if (!initStorageManager()) {
        console.warn('StorageManager not available, some features may not work');
        // Create a minimal fallback
        storageManager = {
          getQuickActions: async () => [],
          getSidebarState: async () => ({isVisible: false})
        };
      }
    }, 100);
  }
  
  // Get DOM elements
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  const connectionsListContainer = document.getElementById('connections-list');
  const connectionsEmptyState = document.getElementById('connections-empty-state');
  const addConnectionBtn2 = document.getElementById('add-connection-btn');
  const addActionBtn = document.getElementById('add-action-btn');
  const restoreDefaultsBtn = document.getElementById('restore-defaults-btn');
  const pluginsList = document.getElementById('plugins-list');
  const managePluginsBtn = document.getElementById('manage-plugins-btn');

  // Setup everything immediately since DOM is ready
  setupTabSystem();
  setupActionsModalListeners();
  
  // Delete action function
  window.deleteAction = async function(actionId) {
    if (confirm('Are you sure you want to delete this action?')) {
      try {
        const quickActions = await storageManager.getQuickActions();
        const filteredActions = quickActions.filter(action => action.id !== actionId);
        await storageManager.setQuickActions(filteredActions);
        loadQuickActions(); // Refresh the list
        showNotification('Action deleted');
      } catch (error) {
        console.error('Error deleting action:', error);
        showNotification('Failed to delete action');
      }
    }
  };
  
  // Edit action function
  window.editAction = function(actionId) {
    openActionEditor(actionId);
  };
  
  // Event listeners
  toggleSidebarBtn?.addEventListener('click', toggleSidebar);
  addConnectionBtn2?.addEventListener('click', openSettings);
  managePluginsBtn?.addEventListener('click', openSettings);
  addActionBtn?.addEventListener('click', () => openActionEditor());
  restoreDefaultsBtn?.addEventListener('click', async () => {
    if (confirm('This will restore all default actions. Continue?')) {
      try {
        await storageManager.resetQuickActionsToDefault();
        loadQuickActions();
        showNotification('Default actions restored');
      } catch (error) {
        console.error('Error restoring defaults:', error);
        showNotification('Failed to restore defaults');
      }
    }
  });
  
  // Initialize data after a short delay to ensure scripts are loaded
  setTimeout(() => {
    loadConnections();
    loadQuickActions();
    loadPlugins();
  }, 200);

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
      if (!storageManager) {
        console.log('StorageManager not available, skipping quick actions');
        return;
      }
      const quickActions = await storageManager.getQuickActions();
      renderActionsList(quickActions);
    } catch (error) {
      console.error('Error loading quick actions:', error);
      // Don't show notification for this, as it's not critical
    }
  }

  // Render actions as editable list
  function renderActionsList(actions) {
    const actionsList = document.getElementById('actions-list');
    actionsList.innerHTML = '';
    
    actions.forEach(action => {
      const actionItem = document.createElement('div');
      actionItem.className = 'llamb-card';
      actionItem.innerHTML = `
        <div class="llamb-card-header">
          <div class="llamb-card-main">
            <img src="${chrome.runtime.getURL('icons/action.svg')}" class="llamb-card-icon" alt="Action">
            <div class="llamb-card-content">
              <div class="llamb-card-title">${action.label}</div>
              <div class="llamb-card-subtitle">${truncateText(action.prompt, 60)}</div>
            </div>
          </div>
        </div>
        <div class="llamb-card-actions">
          <button class="llamb-btn llamb-btn-sm llamb-execute-btn" data-action-id="${action.id}" title="Execute">
            <img src="${chrome.runtime.getURL('icons/play.svg')}" class="llamb-icon" alt="Execute">
          </button>
          <button class="llamb-btn llamb-btn-sm llamb-edit-btn" data-action-id="${action.id}" title="Edit">
            <img src="${chrome.runtime.getURL('icons/edit.svg')}" class="llamb-icon" alt="Edit">
          </button>
          <button class="llamb-btn llamb-btn-sm llamb-delete-btn" data-action-id="${action.id}" title="Delete" ${action.isDefault ? 'disabled' : ''}>
            <img src="${chrome.runtime.getURL('icons/delete.svg')}" class="llamb-icon" alt="Delete">
          </button>
        </div>
      `;
      
      // Add event listeners for action buttons
      const executeBtn = actionItem.querySelector('.llamb-execute-btn');
      const editBtn = actionItem.querySelector('.llamb-edit-btn');
      const deleteBtn = actionItem.querySelector('.llamb-delete-btn');
      
      executeBtn.addEventListener('click', () => executeQuickAction(action));
      editBtn.addEventListener('click', () => openActionEditor(action.id));
      
      if (!action.isDefault) {
        deleteBtn.addEventListener('click', () => deleteAction(action.id));
      } else {
        deleteBtn.style.opacity = '0.5';
        deleteBtn.title = 'Cannot delete default action';
      }
      
      actionsList.appendChild(actionItem);
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


  // Setup modal event listeners
  function setupActionsModalListeners() {
    // Close modal listeners
    document.getElementById('close-editor-modal').addEventListener('click', () => {
      document.getElementById('action-editor-modal').classList.remove('active');
    });
    
    // Form submission
    document.getElementById('action-editor-form').addEventListener('submit', saveAction);
    
    document.getElementById('cancel-editor-btn').addEventListener('click', () => {
      document.getElementById('action-editor-modal').classList.remove('active');
    });
    
    // Close modal when clicking overlay
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

  // Load plugins from background
  async function loadPlugins() {
    try {
      console.log('Loading plugins...');
      
      // Show loading state
      pluginsList.innerHTML = `
        <div class="plugins-empty">
          <img src="${chrome.runtime.getURL('icons/refresh.svg')}" class="llamb-icon loading" alt="Loading">
          <div>Loading plugins...</div>
        </div>
      `;

      const response = await chrome.runtime.sendMessage({ action: 'getAvailablePlugins' });
      console.log('Plugin response:', response);
      
      if (response && response.success && response.plugins) {
        const pluginSettings = await getPluginSettings();
        console.log('Plugin settings:', pluginSettings);
        populatePluginsList(response.plugins, pluginSettings);
      } else {
        console.error('Failed to load plugins:', response?.error);
        
        // Fallback - show YouTube plugin directly since background might not respond
        console.log('Using fallback plugin list');
        const pluginSettings = await getPluginSettings();
        console.log('Fallback plugin settings:', pluginSettings);
        
        const fallbackPlugins = [{
          id: 'youtube-captions',
          name: 'YouTube Captions',
          description: 'Extract captions from YouTube videos',
          version: '1.0.0',
          icon: '💬',
          matches: ['*://www.youtube.com/watch*', '*://youtube.com/watch*'],
          permissions: ['extractContent']
        }];
        
        populatePluginsList(fallbackPlugins, pluginSettings);
      }
    } catch (error) {
      console.error('Error loading plugins:', error);
      
      // Try fallback even on error
      try {
        const pluginSettings = await getPluginSettings();
        const fallbackPlugins = [{
          id: 'youtube-captions',
          name: 'YouTube Captions',
          description: 'Extract captions from YouTube videos',
          version: '1.0.0',
          icon: '💬',
          matches: ['*://www.youtube.com/watch*', '*://youtube.com/watch*'],
          permissions: ['extractContent']
        }];
        
        populatePluginsList(fallbackPlugins, pluginSettings);
      } catch (fallbackError) {
        // Show error with retry option
        pluginsList.innerHTML = `
          <div class="plugins-empty">
            <img src="${chrome.runtime.getURL('icons/refresh.svg')}" class="llamb-icon" alt="Error">
            <div>Failed to load plugins</div>
            <button class="llamb-btn llamb-btn-sm" id="retry-plugins-btn" style="margin-top: 8px;">
              <img src="${chrome.runtime.getURL('icons/refresh.svg')}" class="llamb-icon" alt="Retry">
              Retry
            </button>
          </div>
        `;
        
        // Add retry button event listener
        const retryBtn = document.getElementById('retry-plugins-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', loadPlugins);
        }
      }
    }
  }

  // Get plugin settings from storage
  async function getPluginSettings() {
    try {
      const result = await chrome.storage.local.get('llamb-plugin-settings');
      const settings = result['llamb-plugin-settings'] || {};
      return {
        enabled: settings.enabled || [],
        plugins: settings.plugins || {}
      };
    } catch (error) {
      console.error('Error loading plugin settings:', error);
      return { enabled: [], plugins: {} };
    }
  }

  // Populate plugins list
  function populatePluginsList(plugins, pluginSettings) {
    pluginsList.innerHTML = '';

    if (plugins.length === 0) {
      showPluginsEmpty();
      return;
    }

    plugins.forEach(plugin => {
      const isEnabled = pluginSettings.enabled.includes(plugin.id);
      const pluginItem = createPluginItem(plugin, isEnabled);
      pluginsList.appendChild(pluginItem);
    });
  }

  // Create plugin item element
  function createPluginItem(plugin, isEnabled) {
    const item = document.createElement('div');
    item.className = `llamb-card ${isEnabled ? '' : 'disabled'}`;
    item.dataset.pluginId = plugin.id;

    // Show website matches if available
    const matchesText = plugin.matches && plugin.matches.length > 0 
      ? `Active on: ${plugin.matches.map(m => m.replace('*://', '').replace('/*', '')).join(', ')}`
      : '';

    const statusIcon = isEnabled ? 'check.svg' : 'pause.svg';
    const statusText = isEnabled ? 'Enabled' : 'Disabled';

    item.innerHTML = `
      <div class="llamb-card-header">
        <div class="llamb-card-main">
          <img src="${chrome.runtime.getURL('icons/plugin.svg')}" class="llamb-card-icon" alt="Plugin">
          <div class="llamb-card-content">
            <div class="llamb-card-title">${plugin.name}</div>
            <div class="llamb-card-subtitle">
              <img src="${chrome.runtime.getURL('icons/' + statusIcon)}" class="llamb-icon" alt="${statusText}">
              ${statusText}
            </div>
            ${matchesText ? `<div class="llamb-card-meta">${matchesText}</div>` : ''}
          </div>
        </div>
        <label class="plugin-toggle-popup" title="${isEnabled ? 'Disable plugin' : 'Enable plugin'}">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} data-plugin-id="${plugin.id}">
          <span class="toggle-slider-popup"></span>
        </label>
      </div>
    `;

    // Add event listener for toggle
    const toggleInput = item.querySelector('input[type="checkbox"]');
    toggleInput.addEventListener('change', (e) => handlePluginTogglePopup(e));

    return item;
  }

  // Handle plugin toggle in popup
  async function handlePluginTogglePopup(event) {
    const pluginId = event.target.dataset.pluginId;
    const isEnabled = event.target.checked;
    const pluginItem = document.querySelector(`[data-plugin-id="${pluginId}"]`);
    
    // Show loading state
    const pluginIcon = pluginItem.querySelector('.plugin-icon');
    const originalIcon = pluginIcon.textContent;
    pluginIcon.textContent = '🔄';
    pluginIcon.classList.add('loading');
    
    try {
      // Send message to background script to enable/disable plugin
      const response = await chrome.runtime.sendMessage({
        action: isEnabled ? 'enablePlugin' : 'disablePlugin',
        pluginId: pluginId
      });

      if (response && response.success) {
        // Update visual state
        pluginItem.className = `plugin-item ${isEnabled ? '' : 'disabled'}`;
        const statusElement = pluginItem.querySelector('.plugin-status');
        if (statusElement) {
          statusElement.textContent = isEnabled ? '✅ Enabled' : '⏸️ Disabled';
        }

        // Update tooltip
        const toggleLabel = pluginItem.querySelector('.plugin-toggle-popup');
        toggleLabel.title = isEnabled ? 'Disable plugin' : 'Enable plugin';

        showNotification(`${pluginId.replace('-', ' ')} ${isEnabled ? 'enabled' : 'disabled'}`);
      } else {
        // Revert the toggle if it failed
        event.target.checked = !isEnabled;
        showNotification(`Failed to ${isEnabled ? 'enable' : 'disable'} plugin`);
      }
    } catch (error) {
      console.error('Error toggling plugin:', error);
      // Revert the toggle
      event.target.checked = !isEnabled;
      showNotification('Failed to update plugin settings');
    } finally {
      // Restore original icon
      pluginIcon.textContent = originalIcon;
      pluginIcon.classList.remove('loading');
    }
  }

  // Show empty plugins state
  function showPluginsEmpty() {
    pluginsList.innerHTML = `
      <div class="plugins-empty">
        <img src="${chrome.runtime.getURL('icons/plugin.svg')}" class="llamb-icon" alt="No plugins">
        <div>No plugins available</div>
      </div>
    `;
  }

  // Tab system setup
  function setupTabSystem() {
    console.log('Setting up tab system...');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    console.log('Found', tabButtons.length, 'tab buttons and', tabContents.length, 'tab contents');

    tabButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        console.log('Tab button clicked:', button.dataset.tab);
        const targetTab = button.dataset.tab;
        
        // Update active tab button
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // Update active tab content
        tabContents.forEach(content => {
          content.classList.remove('active');
          if (content.id === `${targetTab}-tab`) {
            content.classList.add('active');
            console.log('Activated tab content:', content.id);
          }
        });

        // Store active tab in local storage
        try {
          localStorage.setItem('llamb-popup-active-tab', targetTab);
        } catch (error) {
          console.error('Error saving tab state:', error);
        }
      });
    });

    // Restore last active tab
    try {
      const lastActiveTab = localStorage.getItem('llamb-popup-active-tab');
      console.log('Last active tab from storage:', lastActiveTab);
      if (lastActiveTab) {
        const tabButton = document.querySelector(`[data-tab="${lastActiveTab}"]`);
        if (tabButton) {
          console.log('Restoring tab:', lastActiveTab);
          tabButton.click();
        }
      }
    } catch (error) {
      console.error('Error restoring tab state:', error);
    }
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

  // Make loadPlugins globally accessible for retry button
  window.loadPlugins = loadPlugins;

  // New connection management functions for redesigned connections tab
  
  // Override the loadConnections function to use card layout
  const originalLoadConnections = loadConnections;
  loadConnections = async function() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getLLMConnections' });
      
      if (response.success) {
        renderConnectionsList(response.connections, response.activeConnectionId);
      } else {
        console.error('Failed to load connections:', response.error);
        showConnectionsEmpty();
      }
    } catch (error) {
      console.error('Error loading connections:', error);
      showConnectionsEmpty();
    }
  };

  // Render connections as cards
  function renderConnectionsList(connections, activeConnectionId) {
    if (connections.length === 0) {
      showConnectionsEmpty();
      return;
    }
    
    connectionsEmptyState.style.display = 'none';
    connectionsListContainer.style.display = 'block';
    connectionsListContainer.innerHTML = '';
    
    connections.forEach(connection => {
      const card = createConnectionCard(connection, connection.id === activeConnectionId);
      connectionsListContainer.appendChild(card);
    });
  }

  // Show empty state for connections
  function showConnectionsEmpty() {
    connectionsListContainer.style.display = 'none';
    connectionsEmptyState.style.display = 'block';
  }

  // Create connection card
  function createConnectionCard(connection, isActive) {
    const card = document.createElement('div');
    card.className = `llamb-card ${isActive ? 'active' : ''}`;
    card.dataset.connectionId = connection.id;
    
    const statusText = connection.enabled ? 'Enabled' : 'Disabled';
    const statusClass = connection.enabled ? 'enabled' : 'disabled';
    
    card.innerHTML = `
      <div class="llamb-card-header">
        <div class="llamb-card-main">
          <div class="llamb-card-content">
            <div class="llamb-card-title">${connection.name}</div>
            <div class="llamb-card-subtitle">${connection.type} • ${connection.model}</div>
          </div>
        </div>
        <div class="llamb-card-badge">
          <div class="llamb-status-dot ${statusClass}"></div>
          <span>${statusText} ${isActive ? '(Active)' : ''}</span>
        </div>
      </div>
      <div class="llamb-card-actions">
        ${!isActive ? `<button class="llamb-btn llamb-btn-sm llamb-set-active-btn" data-connection-id="${connection.id}">
            <img src="${chrome.runtime.getURL('icons/activate.svg')}" class="llamb-icon" alt="Activate">
          </button>` : ''}
        <button class="llamb-btn llamb-btn-sm llamb-test-btn" data-connection-id="${connection.id}" title="Test Connection">
          <img src="${chrome.runtime.getURL('icons/test.svg')}" class="llamb-icon" alt="Test">
        </button>
        <button class="llamb-btn llamb-btn-sm llamb-edit-btn" data-connection-id="${connection.id}" title="Edit">
          <img src="${chrome.runtime.getURL('icons/edit.svg')}" class="llamb-icon" alt="Edit">
        </button>
      </div>
    `;
    
    // Add event listeners for the buttons
    const setActiveBtn = card.querySelector('.llamb-set-active-btn');
    const testBtn = card.querySelector('.llamb-test-btn');
    const editBtn = card.querySelector('.llamb-edit-btn');
    
    if (setActiveBtn) {
      setActiveBtn.addEventListener('click', () => setActiveConnection(connection.id));
    }
    
    testBtn.addEventListener('click', () => testConnection(connection.id));
    editBtn.addEventListener('click', () => editConnection(connection.id));
    
    return card;
  }

  // Set active connection
  async function setActiveConnection(connectionId) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'setActiveConnection',
        connectionId: connectionId
      });

      if (response.success) {
        showNotification('Connection activated');
        loadConnections(); // Refresh the list
      } else {
        showNotification('Failed to activate connection');
      }
    } catch (error) {
      console.error('Error changing connection:', error);
      showNotification('Error changing connection');
    }
  }

  // Test connection
  async function testConnection(connectionId) {
    showNotification('Testing connection...');
    // This could be implemented to actually test the connection
    // For now, just show a placeholder
    setTimeout(() => {
      showNotification('Connection test feature coming soon');
    }, 1000);
  }

  // Edit connection
  function editConnection(connectionId) {
    // Open settings page with the connection ID to edit
    openSettings();
  }

});