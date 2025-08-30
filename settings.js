// Settings Page JavaScript
class SettingsManager {
  constructor() {
    this.storageManager = new StorageManager();
    this.currentEditingId = null;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.loadConnections();
  }

  // Load global settings
  async loadSettings() {
    try {
      const settings = await this.storageManager.getSettings();
      const global = settings.globalSettings;

      document.getElementById('theme-select').value = global.theme || 'auto';
      document.getElementById('max-tokens').value = global.maxTokens || 4000;
      document.getElementById('temperature').value = global.temperature || 0.7;
      document.getElementById('auto-context').checked = global.autoContextCapture !== false;
      document.getElementById('streaming-enabled').checked = global.streamingEnabled !== false;
      document.getElementById('show-thinking').checked = global.showThinkingBlocks !== false;
    } catch (error) {
      this.showToast('Failed to load settings', 'error');
    }
  }

  // Save global settings
  async saveGlobalSettings() {
    try {
      const globalSettings = {
        theme: document.getElementById('theme-select').value,
        maxTokens: parseInt(document.getElementById('max-tokens').value),
        temperature: parseFloat(document.getElementById('temperature').value),
        autoContextCapture: document.getElementById('auto-context').checked,
        streamingEnabled: document.getElementById('streaming-enabled').checked,
        showThinkingBlocks: document.getElementById('show-thinking').checked
      };

      await this.storageManager.updateGlobalSettings(globalSettings);
      this.showToast('Settings saved', 'success');
    } catch (error) {
      this.showToast('Failed to save settings', 'error');
    }
  }

  // Setup event listeners
  setupEventListeners() {
    // Global settings auto-save
    document.getElementById('theme-select').addEventListener('change', () => this.saveGlobalSettings());
    document.getElementById('max-tokens').addEventListener('change', () => this.saveGlobalSettings());
    document.getElementById('temperature').addEventListener('change', () => this.saveGlobalSettings());
    document.getElementById('auto-context').addEventListener('change', () => this.saveGlobalSettings());
    document.getElementById('streaming-enabled').addEventListener('change', () => this.saveGlobalSettings());
    document.getElementById('show-thinking').addEventListener('change', () => this.saveGlobalSettings());

    // Connection management
    document.getElementById('add-connection-btn').addEventListener('click', () => this.openConnectionModal());
    document.getElementById('modal-close-btn').addEventListener('click', () => this.closeConnectionModal());
    document.getElementById('cancel-btn').addEventListener('click', () => this.closeConnectionModal());
    document.getElementById('connection-form').addEventListener('submit', (e) => this.handleConnectionSubmit(e));
    document.getElementById('test-connection-btn').addEventListener('click', () => this.testConnection());
    document.getElementById('fetch-models-btn').addEventListener('click', () => this.fetchModels());
    
    // Model selection handling
    document.getElementById('connection-model-select').addEventListener('change', () => this.handleModelSelect());
    document.getElementById('connection-model-input').addEventListener('input', () => this.handleModelInput());

    // Import/Export
    document.getElementById('export-settings-btn').addEventListener('click', () => this.exportSettings());
    document.getElementById('import-settings-btn').addEventListener('click', () => this.importSettings());
    document.getElementById('import-file-input').addEventListener('change', (e) => this.handleFileImport(e));

    // Modal overlay click to close
    document.getElementById('connection-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('connection-modal')) {
        this.closeConnectionModal();
      }
    });
  }

  // Load and display connections
  async loadConnections() {
    try {
      const settings = await this.storageManager.getSettings();
      const connectionsContainer = document.getElementById('connections-container');
      const emptyState = document.getElementById('empty-state');

      if (settings.connections.length === 0) {
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';
      connectionsContainer.innerHTML = '';

      const connectionsList = document.createElement('div');
      connectionsList.className = 'connection-list';

      for (const connection of settings.connections) {
        const card = this.createConnectionCard(connection, connection.id === settings.activeConnectionId);
        connectionsList.appendChild(card);
      }

      connectionsContainer.appendChild(connectionsList);
    } catch (error) {
      this.showToast('Failed to load connections', 'error');
    }
  }

  // Create connection card HTML
  createConnectionCard(connection, isActive) {
    const card = document.createElement('div');
    card.className = `connection-card ${isActive ? 'active' : ''}`;
    card.dataset.id = connection.id;

    const statusText = connection.enabled ? 'Enabled' : 'Disabled';
    const statusClass = connection.enabled ? 'enabled' : 'disabled';

    card.innerHTML = `
      <div class="connection-header">
        <h3 class="connection-name">${connection.name}</h3>
        <div class="connection-status">
          <div class="status-dot ${statusClass}"></div>
          ${statusText} ${isActive ? '(Active)' : ''}
        </div>
      </div>
      
      <div class="connection-details">
        <strong>Type:</strong> <span>${connection.type}</span>
        <strong>Model:</strong> <span>${connection.model}</span>
        <strong>Endpoint:</strong> <span>${this.truncateUrl(connection.endpoint)}</span>
        <strong>Features:</strong> <span>${this.formatFeatures(connection.features)}</span>
      </div>
      
      <div class="connection-actions">
        ${!isActive ? `<button class="btn set-active-btn" data-connection-id="${connection.id}">Set Active</button>` : ''}
        <button class="btn test-btn" data-connection-id="${connection.id}">Test</button>
        <button class="btn edit-btn" data-connection-id="${connection.id}">Edit</button>
        <button class="btn danger delete-btn" data-connection-id="${connection.id}">Delete</button>
      </div>
    `;

    // Add event listeners for the buttons
    this.addCardEventListeners(card, connection.id);

    return card;
  }

  // Add event listeners to connection card buttons
  addCardEventListeners(card, connectionId) {
    const setActiveBtn = card.querySelector('.set-active-btn');
    const testBtn = card.querySelector('.test-btn');
    const editBtn = card.querySelector('.edit-btn');
    const deleteBtn = card.querySelector('.delete-btn');

    if (setActiveBtn) {
      setActiveBtn.addEventListener('click', () => this.setActiveConnection(connectionId));
    }

    if (testBtn) {
      testBtn.addEventListener('click', () => this.testConnectionById(connectionId));
    }

    if (editBtn) {
      editBtn.addEventListener('click', () => this.editConnection(connectionId));
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteConnection(connectionId));
    }
  }

  // Format features for display
  formatFeatures(features) {
    const enabled = [];
    if (features.streaming) enabled.push('Streaming');
    if (features.reasoning) enabled.push('Reasoning');
    if (features.thinking) enabled.push('Thinking');
    return enabled.length > 0 ? enabled.join(', ') : 'Basic';
  }

  // Truncate URL for display
  truncateUrl(url) {
    return url.length > 40 ? url.substring(0, 37) + '...' : url;
  }

  // Open connection modal
  openConnectionModal(connection = null) {
    this.currentEditingId = connection ? connection.id : null;
    const modal = document.getElementById('connection-modal');
    const title = document.getElementById('modal-title');
    
    title.textContent = connection ? 'Edit Connection' : 'Add Connection';
    
    if (connection) {
      this.populateConnectionForm(connection);
    } else {
      this.clearConnectionForm();
    }
    
    modal.classList.add('active');
  }

  // Close connection modal
  closeConnectionModal() {
    document.getElementById('connection-modal').classList.remove('active');
    this.currentEditingId = null;
    this.clearConnectionForm();
  }

  // Populate form with connection data
  populateConnectionForm(connection) {
    document.getElementById('connection-name').value = connection.name;
    document.getElementById('connection-type').value = connection.type;
    document.getElementById('connection-endpoint').value = connection.endpoint;
    document.getElementById('connection-api-key').value = connection.apiKey || '';
    
    // Handle model - try to set in select first, otherwise use input
    const modelSelect = document.getElementById('connection-model-select');
    const modelInput = document.getElementById('connection-model-input');
    
    // Check if model exists in select options
    let modelFound = false;
    for (let option of modelSelect.options) {
      if (option.value === connection.model) {
        modelSelect.value = connection.model;
        modelInput.value = '';
        modelFound = true;
        break;
      }
    }
    
    // If not found in select, use input field
    if (!modelFound) {
      modelSelect.value = '';
      modelInput.value = connection.model;
    }
    
    document.getElementById('context-window').value = connection.features?.contextWindow || 4096;
    document.getElementById('connection-timeout').value = connection.timeout || 30000;
    
    document.getElementById('feature-streaming').checked = connection.features?.streaming !== false;
    document.getElementById('feature-reasoning').checked = connection.features?.reasoning || false;
    document.getElementById('feature-thinking').checked = connection.features?.thinking || false;
    document.getElementById('connection-enabled').checked = connection.enabled !== false;
    
    document.getElementById('custom-headers').value = JSON.stringify(connection.customHeaders || {}, null, 2);
  }

  // Clear connection form
  clearConnectionForm() {
    document.getElementById('connection-form').reset();
    document.getElementById('context-window').value = 4096;
    document.getElementById('connection-timeout').value = 30000;
    document.getElementById('custom-headers').value = '{}';
    document.getElementById('feature-streaming').checked = true;
    document.getElementById('connection-enabled').checked = true;
    
    // Clear model fields
    document.getElementById('connection-model-select').value = '';
    document.getElementById('connection-model-input').value = '';
  }

  // Handle connection form submission
  async handleConnectionSubmit(e) {
    e.preventDefault();
    
    try {
      const formData = this.getConnectionFormData();
      
      if (this.currentEditingId) {
        await this.storageManager.updateConnection(this.currentEditingId, formData);
        this.showToast('Connection updated', 'success');
      } else {
        await this.storageManager.addConnection(formData);
        this.showToast('Connection added', 'success');
      }
      
      this.closeConnectionModal();
      await this.loadConnections();
    } catch (error) {
      this.showToast('Failed to save connection: ' + error.message, 'error');
    }
  }

  // Get form data
  getConnectionFormData() {
    let customHeaders = {};
    try {
      const headersText = document.getElementById('custom-headers').value.trim();
      if (headersText) {
        customHeaders = JSON.parse(headersText);
      }
    } catch (error) {
      throw new Error('Invalid JSON in custom headers');
    }

    // Get model from select or input field
    const modelSelect = document.getElementById('connection-model-select').value;
    const modelInput = document.getElementById('connection-model-input').value.trim();
    const model = modelSelect || modelInput;
    
    if (!model) {
      throw new Error('Model is required');
    }

    return {
      name: document.getElementById('connection-name').value.trim(),
      type: document.getElementById('connection-type').value,
      endpoint: document.getElementById('connection-endpoint').value.trim(),
      apiKey: document.getElementById('connection-api-key').value.trim() || null,
      model: model,
      enabled: document.getElementById('connection-enabled').checked,
      timeout: parseInt(document.getElementById('connection-timeout').value),
      features: {
        streaming: document.getElementById('feature-streaming').checked,
        reasoning: document.getElementById('feature-reasoning').checked,
        thinking: document.getElementById('feature-thinking').checked,
        contextWindow: parseInt(document.getElementById('context-window').value)
      },
      customHeaders
    };
  }

  // Test connection
  async testConnection() {
    try {
      const formData = this.getConnectionFormData();
      this.setTestingState(true);
      
      const result = await this.storageManager.testConnection(formData);
      
      if (result.success) {
        this.showToast('Connection test successful!', 'success');
      } else {
        this.showToast(`Connection test failed: ${result.message}`, 'error');
      }
    } catch (error) {
      this.showToast('Connection test error: ' + error.message, 'error');
    } finally {
      this.setTestingState(false);
    }
  }

  // Test connection by ID
  async testConnectionById(connectionId) {
    try {
      const connection = await this.storageManager.getConnection(connectionId);
      if (!connection) {
        this.showToast('Connection not found', 'error');
        return;
      }

      const card = document.querySelector(`[data-id="${connectionId}"] .status-dot`);
      if (card) {
        card.className = 'status-dot testing';
      }

      const result = await this.storageManager.testConnection(connection);
      
      if (card) {
        card.className = `status-dot ${connection.enabled ? 'enabled' : 'disabled'}`;
      }

      if (result.success) {
        this.showToast(`${connection.name}: Connection successful!`, 'success');
      } else {
        this.showToast(`${connection.name}: ${result.message}`, 'error');
      }
    } catch (error) {
      this.showToast('Test failed: ' + error.message, 'error');
    }
  }

  // Set testing state
  setTestingState(isTesting) {
    const btn = document.getElementById('test-connection-btn');
    if (isTesting) {
      btn.textContent = '🔄 Testing...';
      btn.disabled = true;
    } else {
      btn.textContent = '🧪 Test Connection';
      btn.disabled = false;
    }
  }

  // Edit connection
  async editConnection(connectionId) {
    try {
      const connection = await this.storageManager.getConnection(connectionId);
      if (connection) {
        this.openConnectionModal(connection);
      }
    } catch (error) {
      this.showToast('Failed to load connection', 'error');
    }
  }

  // Delete connection
  async deleteConnection(connectionId) {
    if (!confirm('Are you sure you want to delete this connection?')) {
      return;
    }

    try {
      await this.storageManager.deleteConnection(connectionId);
      this.showToast('Connection deleted', 'success');
      await this.loadConnections();
    } catch (error) {
      this.showToast('Failed to delete connection', 'error');
    }
  }

  // Set active connection
  async setActiveConnection(connectionId) {
    try {
      await this.storageManager.setActiveConnection(connectionId);
      this.showToast('Active connection updated', 'success');
      await this.loadConnections();
    } catch (error) {
      this.showToast('Failed to set active connection', 'error');
    }
  }

  // Export settings
  async exportSettings() {
    try {
      const settingsJson = await this.storageManager.exportSettings();
      const blob = new Blob([settingsJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `llamb-settings-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this.showToast('Settings exported', 'success');
    } catch (error) {
      this.showToast('Export failed', 'error');
    }
  }

  // Fetch available models from the endpoint
  async fetchModels() {
    const fetchBtn = document.getElementById('fetch-models-btn');
    const originalText = fetchBtn.textContent;
    
    try {
      // Get current endpoint and API key for fetching models
      const endpoint = document.getElementById('connection-endpoint').value.trim();
      const apiKey = document.getElementById('connection-api-key').value.trim();
      
      if (!endpoint) {
        this.showToast('Please enter an endpoint URL first', 'error');
        return;
      }

      fetchBtn.textContent = '🔄 Fetching...';
      fetchBtn.disabled = true;

      // Build the models endpoint URL
      const modelsUrl = endpoint.replace(/\/+$/, '') + '/models';
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      console.log('Fetching models from:', modelsUrl);
      
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: headers,
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Models response:', data);

      // Parse models based on OpenAI API format
      let models = [];
      if (data.data && Array.isArray(data.data)) {
        // OpenAI format: { data: [{id: "model-name", ...}, ...] }
        models = data.data.map(model => ({
          id: model.id,
          name: model.id,
          owned_by: model.owned_by || 'unknown'
        }));
      } else if (data.models && Array.isArray(data.models)) {
        // Alternative format: { models: [...] }
        models = data.models.map(model => ({
          id: typeof model === 'string' ? model : model.id || model.name,
          name: typeof model === 'string' ? model : model.name || model.id,
          owned_by: typeof model === 'string' ? 'unknown' : (model.owned_by || 'unknown')
        }));
      } else if (Array.isArray(data)) {
        // Simple array format: ["model1", "model2", ...]
        models = data.map(model => ({
          id: typeof model === 'string' ? model : model.id || model.name,
          name: typeof model === 'string' ? model : model.name || model.id,
          owned_by: typeof model === 'string' ? 'unknown' : (model.owned_by || 'unknown')
        }));
      } else {
        throw new Error('Unexpected response format');
      }

      if (models.length === 0) {
        throw new Error('No models found in response');
      }

      // Populate the select dropdown
      const modelSelect = document.getElementById('connection-model-select');
      modelSelect.innerHTML = '<option value="">Select a model...</option>';
      
      // Sort models alphabetically
      models.sort((a, b) => a.name.localeCompare(b.name));
      
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        if (model.owned_by && model.owned_by !== 'unknown') {
          option.textContent += ` (${model.owned_by})`;
        }
        modelSelect.appendChild(option);
      });

      this.showToast(`Found ${models.length} models`, 'success');
      
    } catch (error) {
      console.error('Error fetching models:', error);
      this.showToast('Failed to fetch models: ' + error.message, 'error');
    } finally {
      fetchBtn.textContent = originalText;
      fetchBtn.disabled = false;
    }
  }

  // Handle model selection from dropdown
  handleModelSelect() {
    const modelSelect = document.getElementById('connection-model-select');
    const modelInput = document.getElementById('connection-model-input');
    
    if (modelSelect.value) {
      // Clear input when selecting from dropdown
      modelInput.value = '';
    }
  }

  // Handle manual model input
  handleModelInput() {
    const modelSelect = document.getElementById('connection-model-select');
    const modelInput = document.getElementById('connection-model-input');
    
    if (modelInput.value.trim()) {
      // Clear dropdown when typing manually
      modelSelect.value = '';
    }
  }

  // Import settings
  importSettings() {
    document.getElementById('import-file-input').click();
  }

  // Handle file import
  async handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      await this.storageManager.importSettings(text);
      this.showToast('Settings imported successfully', 'success');
      await this.loadSettings();
      await this.loadConnections();
    } catch (error) {
      this.showToast('Import failed: ' + error.message, 'error');
    }
  }

  // Show toast notification
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
  }
}

// Initialize when DOM is ready
let settingsManager;
document.addEventListener('DOMContentLoaded', () => {
  settingsManager = new SettingsManager();
});