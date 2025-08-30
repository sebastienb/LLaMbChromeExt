// Storage Manager - Handle settings and connection persistence
class StorageManager {
  constructor() {
    this.storageKey = 'llamb-settings';
    this.defaultSettings = {
      connections: [],
      activeConnectionId: null,
      fallbackEnabled: true,
      globalSettings: {
        theme: 'auto',
        autoContextCapture: true,
        streamingEnabled: true,
        showThinkingBlocks: true,
        maxTokens: 4000,
        temperature: 0.7
      }
    };
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
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
} else if (typeof globalThis !== 'undefined') {
  globalThis.StorageManager = StorageManager;
} else if (typeof self !== 'undefined') {
  self.StorageManager = StorageManager;
}