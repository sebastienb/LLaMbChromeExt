// Storage Manager - Handle settings and connection persistence
class StorageManager {
  constructor() {
    this.storageKey = 'llamb-settings';
    this.sidebarStateKey = 'llamb-sidebar-state';
    this.activeChatKey = 'llamb-active-chat';
    this.defaultSettings = {
      connections: [],
      activeConnectionId: null,
      fallbackEnabled: true,
      quickActions: this.getDefaultQuickActions(),
      globalSettings: {
        theme: 'auto',
        autoContextCapture: true,
        streamingEnabled: true,
        showThinkingBlocks: true,
        maxTokens: 4000,
        temperature: 0.7,
        debugLogging: false  // Debug logging disabled by default
      }
    };
  }

  // Get default quick actions
  getDefaultQuickActions() {
    return [
      {
        id: 'summarize',
        label: 'Summarize this page',
        icon: '📝',
        prompt: 'Please summarize this webpage:\nTitle: {pageTitle}\nURL: {pageUrl}\n\nContent:\n{pageContent}\n\nProvide a concise summary of the main points.',
        usePageContext: true,
        isDefault: true,
        order: 1
      },
      {
        id: 'explain-selected',
        label: 'Explain selected text',
        icon: '🔍',
        prompt: 'Please explain this selected text from {pageTitle}:\n\n"{selectedText}"\n\nProvide a clear explanation of what this means.',
        usePageContext: true,
        isDefault: true,
        order: 2
      },
      {
        id: 'what-about',
        label: 'What is this page about?',
        icon: '❓',
        prompt: 'What is this webpage about?\nTitle: {pageTitle}\nURL: {pageUrl}\n\nContent:\n{pageContent}\n\nProvide a brief overview of the main topic and purpose.',
        usePageContext: true,
        isDefault: true,
        order: 3
      },
      {
        id: 'key-takeaways',
        label: 'Key takeaways',
        icon: '💡',
        prompt: 'What are the key takeaways from this page?\nTitle: {pageTitle}\n\nContent:\n{pageContent}\n\nList the most important points and insights.',
        usePageContext: true,
        isDefault: true,
        order: 4
      }
    ];
  }

  // Get all settings
  async getSettings() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      return result[this.storageKey] || this.defaultSettings;
    } catch (error) {
      console.error('StorageManager: Error getting settings:', error);
      return this.defaultSettings;
    }
  }

  // Save all settings
  async saveSettings(settings) {
    try {
      await chrome.storage.local.set({
        [this.storageKey]: settings
      });
      return true;
    } catch (error) {
      console.error('StorageManager: Error saving settings:', error);
      return false;
    }
  }

  // Get specific connection by ID
  async getConnection(connectionId) {
    const settings = await this.getSettings();
    return settings.connections.find(conn => conn.id === connectionId) || null;
  }

  // Get active connection
  async getActiveConnection() {
    const settings = await this.getSettings();
    if (!settings.activeConnectionId) return null;
    
    return settings.connections.find(conn => 
      conn.id === settings.activeConnectionId && conn.enabled
    ) || null;
  }

  // Add new connection
  async addConnection(connectionData) {
    const settings = await this.getSettings();
    const newConnection = {
      id: this.generateUUID(),
      name: connectionData.name || 'New Connection',
      type: connectionData.type || 'openai-compatible',
      endpoint: connectionData.endpoint || '',
      apiKey: connectionData.apiKey || null,
      model: connectionData.model || '',
      enabled: connectionData.enabled !== false,
      priority: settings.connections.length + 1,
      features: {
        streaming: connectionData.features?.streaming !== false,
        reasoning: connectionData.features?.reasoning || false,
        thinking: connectionData.features?.thinking || false,
        contextWindow: connectionData.features?.contextWindow || 4096
      },
      customHeaders: connectionData.customHeaders || {},
      timeout: connectionData.timeout || 30000,
      createdAt: new Date().toISOString()
    };

    settings.connections.push(newConnection);
    
    // Set as active if it's the first connection
    if (settings.connections.length === 1) {
      settings.activeConnectionId = newConnection.id;
    }

    await this.saveSettings(settings);
    return newConnection;
  }

  // Update existing connection
  async updateConnection(connectionId, updates) {
    const settings = await this.getSettings();
    const connectionIndex = settings.connections.findIndex(conn => conn.id === connectionId);
    
    if (connectionIndex === -1) {
      throw new Error('Connection not found');
    }

    settings.connections[connectionIndex] = {
      ...settings.connections[connectionIndex],
      ...updates,
      id: connectionId, // Ensure ID doesn't change
      updatedAt: new Date().toISOString()
    };

    await this.saveSettings(settings);
    return settings.connections[connectionIndex];
  }

  // Delete connection
  async deleteConnection(connectionId) {
    const settings = await this.getSettings();
    const connectionIndex = settings.connections.findIndex(conn => conn.id === connectionId);
    
    if (connectionIndex === -1) {
      throw new Error('Connection not found');
    }

    settings.connections.splice(connectionIndex, 1);

    // If this was the active connection, choose a new one
    if (settings.activeConnectionId === connectionId) {
      const enabledConnections = settings.connections.filter(conn => conn.enabled);
      settings.activeConnectionId = enabledConnections.length > 0 ? enabledConnections[0].id : null;
    }

    await this.saveSettings(settings);
    return true;
  }

  // Set active connection
  async setActiveConnection(connectionId) {
    const settings = await this.getSettings();
    const connection = settings.connections.find(conn => conn.id === connectionId);
    
    if (!connection) {
      throw new Error('Connection not found');
    }

    if (!connection.enabled) {
      throw new Error('Cannot activate disabled connection');
    }

    settings.activeConnectionId = connectionId;
    await this.saveSettings(settings);
    return connection;
  }

  // Get all enabled connections sorted by priority
  async getEnabledConnections() {
    const settings = await this.getSettings();
    return settings.connections
      .filter(conn => conn.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  // Test if a connection configuration is valid
  async testConnection(connectionData) {
    try {
      const testUrl = connectionData.endpoint.replace(/\/+$/, '') + '/models';
      const headers = {
        'Content-Type': 'application/json',
        ...connectionData.customHeaders
      };

      if (connectionData.apiKey) {
        headers['Authorization'] = `Bearer ${connectionData.apiKey}`;
      }

      const response = await fetch(testUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(connectionData.timeout || 10000)
      });

      return {
        success: response.ok,
        status: response.status,
        message: response.ok ? 'Connection successful' : `HTTP ${response.status}`
      };
    } catch (error) {
      return {
        success: false,
        status: 0,
        message: error.message
      };
    }
  }

  // Update global settings
  async updateGlobalSettings(updates) {
    const settings = await this.getSettings();
    settings.globalSettings = {
      ...settings.globalSettings,
      ...updates
    };
    await this.saveSettings(settings);
    return settings.globalSettings;
  }

  // Import settings from JSON
  async importSettings(settingsJson) {
    try {
      const importedSettings = typeof settingsJson === 'string' 
        ? JSON.parse(settingsJson) 
        : settingsJson;

      // Validate imported settings structure
      if (!importedSettings.connections || !Array.isArray(importedSettings.connections)) {
        throw new Error('Invalid settings format');
      }

      // Generate new IDs for imported connections to avoid conflicts
      importedSettings.connections.forEach(conn => {
        conn.id = this.generateUUID();
      });

      await this.saveSettings(importedSettings);
      return true;
    } catch (error) {
      console.error('StorageManager: Error importing settings:', error);
      throw new Error('Failed to import settings: ' + error.message);
    }
  }

  // Export settings to JSON
  async exportSettings() {
    const settings = await this.getSettings();
    // Remove sensitive data from export
    const exportSettings = {
      ...settings,
      connections: settings.connections.map(conn => ({
        ...conn,
        apiKey: conn.apiKey ? '[REDACTED]' : null
      }))
    };
    return JSON.stringify(exportSettings, null, 2);
  }

  // Get quick actions sorted by order
  async getQuickActions() {
    const settings = await this.getSettings();
    return settings.quickActions ? 
      settings.quickActions.sort((a, b) => (a.order || 0) - (b.order || 0)) :
      this.getDefaultQuickActions();
  }

  // Save quick actions
  async saveQuickActions(quickActions) {
    const settings = await this.getSettings();
    settings.quickActions = quickActions.map((action, index) => ({
      ...action,
      order: action.order || (index + 1)
    }));
    await this.saveSettings(settings);
    return settings.quickActions;
  }

  // Add new quick action
  async addQuickAction(actionData) {
    const settings = await this.getSettings();
    const quickActions = settings.quickActions || this.getDefaultQuickActions();
    
    const newAction = {
      id: this.generateUUID(),
      label: actionData.label || 'New Action',
      icon: actionData.icon || '⚡',
      prompt: actionData.prompt || 'Please help me with: {pageTitle}',
      usePageContext: actionData.usePageContext !== false,
      isDefault: false,
      order: Math.max(...quickActions.map(a => a.order || 0), 0) + 1,
      createdAt: new Date().toISOString()
    };

    quickActions.push(newAction);
    settings.quickActions = quickActions;
    await this.saveSettings(settings);
    return newAction;
  }

  // Update existing quick action
  async updateQuickAction(actionId, updates) {
    const settings = await this.getSettings();
    const quickActions = settings.quickActions || this.getDefaultQuickActions();
    const actionIndex = quickActions.findIndex(action => action.id === actionId);
    
    if (actionIndex === -1) {
      throw new Error('Quick action not found');
    }

    quickActions[actionIndex] = {
      ...quickActions[actionIndex],
      ...updates,
      id: actionId, // Ensure ID doesn't change
      updatedAt: new Date().toISOString()
    };

    settings.quickActions = quickActions;
    await this.saveSettings(settings);
    return quickActions[actionIndex];
  }

  // Delete quick action
  async deleteQuickAction(actionId) {
    const settings = await this.getSettings();
    const quickActions = settings.quickActions || this.getDefaultQuickActions();
    const actionIndex = quickActions.findIndex(action => action.id === actionId);
    
    if (actionIndex === -1) {
      throw new Error('Quick action not found');
    }

    quickActions.splice(actionIndex, 1);
    settings.quickActions = quickActions;
    await this.saveSettings(settings);
    return true;
  }

  // Reset quick actions to defaults
  async resetQuickActionsToDefault() {
    const settings = await this.getSettings();
    settings.quickActions = this.getDefaultQuickActions();
    await this.saveSettings(settings);
    return settings.quickActions;
  }

  // Reorder quick actions
  async reorderQuickActions(actionIds) {
    const settings = await this.getSettings();
    const quickActions = settings.quickActions || this.getDefaultQuickActions();
    
    // Create new order based on provided IDs
    const reorderedActions = actionIds.map((id, index) => {
      const action = quickActions.find(a => a.id === id);
      return action ? { ...action, order: index + 1 } : null;
    }).filter(Boolean);

    // Add any actions not in the reorder list at the end
    quickActions.forEach(action => {
      if (!actionIds.includes(action.id)) {
        reorderedActions.push({ ...action, order: reorderedActions.length + 1 });
      }
    });

    settings.quickActions = reorderedActions;
    await this.saveSettings(settings);
    return reorderedActions;
  }

  // Generate UUID v4
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Reset to defaults
  async resetSettings() {
    await chrome.storage.local.remove(this.storageKey);
    return this.defaultSettings;
  }

  // Sidebar state management
  async getSidebarState(tabId) {
    try {
      const result = await chrome.storage.session.get(`${this.sidebarStateKey}-${tabId}`);
      return result[`${this.sidebarStateKey}-${tabId}`] || { isVisible: false, chatId: null };
    } catch (error) {
      console.error('StorageManager: Error getting sidebar state:', error);
      return { isVisible: false, chatId: null };
    }
  }

  async setSidebarState(tabId, state) {
    try {
      // Handle both old format (isVisible, chatId) and new format (state object)
      const stateToSave = typeof state === 'object' && state.hasOwnProperty('isVisible') ? {
        isVisible: state.isVisible,
        isFloatingMode: state.isFloatingMode || false,
        floatingPosition: state.floatingPosition || { x: 20, y: 20 },
        floatingSize: state.floatingSize || { width: 400, height: 600 },
        chatId: state.chatId,
        timestamp: Date.now()
      } : {
        // Legacy format support
        isVisible: state,
        isFloatingMode: false,
        floatingPosition: { x: 20, y: 20 },
        floatingSize: { width: 400, height: 600 },
        chatId: arguments[2] || null,
        timestamp: Date.now()
      };
      
      await chrome.storage.session.set({
        [`${this.sidebarStateKey}-${tabId}`]: stateToSave
      });
      return true;
    } catch (error) {
      console.error('StorageManager: Error setting sidebar state:', error);
      return false;
    }
  }

  // Active chat management
  async getActiveChat() {
    try {
      const result = await chrome.storage.session.get(this.activeChatKey);
      return result[this.activeChatKey] || null;
    } catch (error) {
      console.error('StorageManager: Error getting active chat:', error);
      return null;
    }
  }

  async setActiveChat(chatId) {
    try {
      await chrome.storage.session.set({
        [this.activeChatKey]: {
          chatId: chatId,
          timestamp: Date.now()
        }
      });
      return true;
    } catch (error) {
      console.error('StorageManager: Error setting active chat:', error);
      return false;
    }
  }

  async clearActiveChat() {
    try {
      await chrome.storage.session.remove(this.activeChatKey);
      return true;
    } catch (error) {
      console.error('StorageManager: Error clearing active chat:', error);
      return false;
    }
  }

  // Chat session cleanup
  async cleanupOldSessions() {
    try {
      // Get all session storage keys
      const allSession = await chrome.storage.session.get();
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      const keysToRemove = [];
      
      Object.keys(allSession).forEach(key => {
        if (key.startsWith(this.sidebarStateKey) || key === this.activeChatKey) {
          const data = allSession[key];
          if (data && data.timestamp && (now - data.timestamp) > maxAge) {
            keysToRemove.push(key);
          }
        }
      });

      if (keysToRemove.length > 0) {
        await chrome.storage.session.remove(keysToRemove);
        console.log('StorageManager: Cleaned up old sessions:', keysToRemove.length);
      }
      
      return keysToRemove.length;
    } catch (error) {
      console.error('StorageManager: Error cleaning up sessions:', error);
      return 0;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
} else if (typeof globalThis !== 'undefined') {
  globalThis.StorageManager = StorageManager;
} else if (typeof self !== 'undefined') {
  self.StorageManager = StorageManager;
}