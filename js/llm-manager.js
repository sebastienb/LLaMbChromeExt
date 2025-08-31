// LLM Manager - Core orchestration for LLM interactions
class LLMManager {
  constructor() {
    this.storageManager = new StorageManager();
    this.providers = new LLMProviders();
    this.streamParser = new StreamParser();
    
    this.activeRequests = new Map(); // Track ongoing requests
    this.requestQueue = []; // Queue for rate limiting
    this.isProcessingQueue = false;
    
    // Event listeners for real-time updates
    this.eventListeners = new Map();
  }

  // Initialize the manager
  async initialize() {
    try {
      const settings = await this.storageManager.getSettings();
      console.log('LLMManager: Initialized with', settings.connections.length, 'connections');
      return true;
    } catch (error) {
      console.error('LLMManager: Initialization failed:', error);
      return false;
    }
  }

  // Send a message to the active LLM
  async sendMessage(messageText, pageContext = null, options = {}) {
    const requestId = this.generateRequestId();
    console.log('LLMManager: Starting sendMessage, requestId:', requestId);
    
    try {
      // Get active connection
      const connection = await this.storageManager.getActiveConnection();
      console.log('LLMManager: Active connection:', connection);
      if (!connection) {
        throw new Error('No active LLM connection configured');
      }

      // Build message array
      const messages = await this.buildMessageArray(messageText, pageContext, options);
      console.log('LLMManager: Built messages:', messages);
      
      // Get provider
      const provider = this.providers.getProvider(connection.type);
      console.log('LLMManager: Using provider:', provider.name);
      
      // Send message based on streaming preference
      if (options.streaming !== false && connection.features.streaming) {
        console.log('LLMManager: Sending streaming message');
        return await this.sendStreamingMessage(requestId, connection, provider, messages, options);
      } else {
        console.log('LLMManager: Sending single message');
        return await this.sendSingleMessage(requestId, connection, provider, messages, options);
      }
    } catch (error) {
      this.emit('error', { requestId, error: error.message });
      throw error;
    }
  }

  // Send streaming message
  async sendStreamingMessage(requestId, connection, provider, messages, options) {
    console.log('LLMManager: Starting streaming message, requestId:', requestId);
    this.emit('streamStart', { requestId, connection: connection.name });
    
    try {
      console.log('LLMManager: Calling provider.sendStreamingMessage');
      const responseStream = await provider.sendStreamingMessage(connection, messages, options);
      console.log('LLMManager: Got response stream:', responseStream);
      const reader = responseStream.getReader();
      
      let accumulatedContent = '';
      let allBlocks = [];
      
      const processChunk = async () => {
        try {
          console.log('LLMManager: Reading next chunk...');
          const { done, value } = await reader.read();
          
          if (done) {
            console.log('LLMManager: Stream finished, emitting streamEnd');
            this.emit('streamEnd', { 
              requestId, 
              fullContent: accumulatedContent,
              blocks: allBlocks
            });
            return;
          }

          const chunk = new TextDecoder().decode(value);
          console.log('LLMManager: Raw chunk received:', chunk);
          
          const parsedChunks = this.streamParser.parseChunk(chunk, 'openai-sse');
          console.log('LLMManager: Parsed chunks:', parsedChunks);
          
          for (const parsedChunk of parsedChunks) {
            if (parsedChunk.type === 'content') {
              accumulatedContent += parsedChunk.content;
              if (parsedChunk.blocks) {
                allBlocks.push(...parsedChunk.blocks);
              }
              
              console.log('LLMManager: Emitting streamChunk:', {
                requestId,
                content: parsedChunk.content,
                fullContent: accumulatedContent
              });
              
              this.emit('streamChunk', {
                requestId,
                content: parsedChunk.content,
                blocks: parsedChunk.blocks,
                fullContent: accumulatedContent,
                metadata: parsedChunk.metadata
              });
            } else if (parsedChunk.type === 'done') {
              console.log('LLMManager: Got done signal, emitting streamEnd');
              this.emit('streamEnd', { 
                requestId, 
                fullContent: accumulatedContent,
                blocks: allBlocks
              });
              return;
            }
          }
          
          // Continue reading
          processChunk();
        } catch (error) {
          console.error('LLMManager: Stream processing error:', error);
          this.emit('streamError', { requestId, error: error.message });
          throw error;
        }
      };
      
      processChunk();
      
      return { requestId, type: 'streaming' };
    } catch (error) {
      this.emit('streamError', { requestId, error: error.message });
      throw error;
    }
  }

  // Send single message (non-streaming)
  async sendSingleMessage(requestId, connection, provider, messages, options) {
    this.emit('messageStart', { requestId, connection: connection.name });
    
    try {
      const response = await provider.sendMessage(connection, messages, options);
      const parsedResponse = this.streamParser.parseCompleteResponse(response.content);
      
      const result = {
        requestId,
        type: 'complete',
        content: parsedResponse.content,
        blocks: parsedResponse.blocks,
        usage: response.usage,
        model: response.model,
        finishReason: response.finishReason
      };
      
      this.emit('messageComplete', result);
      return result;
    } catch (error) {
      this.emit('messageError', { requestId, error: error.message });
      throw error;
    }
  }

  // Build message array from input
  async buildMessageArray(messageText, pageContext = null, options = {}) {
    const messages = [];
    
    // Add system message if needed
    if (options.systemMessage) {
      messages.push({
        role: 'system',
        content: options.systemMessage
      });
    }

    // Add page context if available
    if (pageContext && options.includeContext !== false) {
      const contextMessage = this.formatPageContext(pageContext);
      if (contextMessage) {
        messages.push({
          role: 'system',
          content: contextMessage
        });
      }
    }

    // Add conversation history if provided
    if (options.conversationHistory && Array.isArray(options.conversationHistory)) {
      messages.push(...options.conversationHistory);
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: messageText
    });

    return messages;
  }

  // Format page context for LLM
  formatPageContext(pageContext) {
    let contextText = 'Current webpage context:\n';
    
    if (pageContext.title) {
      contextText += `Title: ${pageContext.title}\n`;
    }
    
    if (pageContext.url) {
      contextText += `URL: ${pageContext.url}\n`;
    }
    
    if (pageContext.selectedText) {
      contextText += `\nSelected text from page:\n"${pageContext.selectedText}"\n`;
    }
    
    // Add plugin content separately if available (e.g., YouTube captions)
    if (pageContext.pluginContent) {
      contextText += `\n## Additional extracted content:\n${pageContext.pluginContent}\n`;
    }
    
    // Add page content separately with clear labeling
    if (pageContext.markdownContent) {
      contextText += `\n## Page HTML content (in markdown format):\n\`\`\`markdown\n${pageContext.markdownContent}\n\`\`\`\n`;
    } else if (pageContext.visibleText) {
      contextText += `\n## Visible page text:\n${pageContext.visibleText.substring(0, 2000)}${pageContext.visibleText.length > 2000 ? '...' : ''}\n`;
    }
    
    contextText += '\nPlease consider this context when responding to the user\'s question.';
    return contextText;
  }

  // Connection management
  async addConnection(connectionData) {
    try {
      const connection = await this.storageManager.addConnection(connectionData);
      this.emit('connectionAdded', connection);
      return connection;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  async updateConnection(connectionId, updates) {
    try {
      const connection = await this.storageManager.updateConnection(connectionId, updates);
      this.emit('connectionUpdated', connection);
      return connection;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  async deleteConnection(connectionId) {
    try {
      await this.storageManager.deleteConnection(connectionId);
      this.emit('connectionDeleted', { connectionId });
      return true;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  async setActiveConnection(connectionId) {
    try {
      const connection = await this.storageManager.setActiveConnection(connectionId);
      this.emit('activeConnectionChanged', connection);
      return connection;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  async testConnection(connectionData) {
    try {
      const result = await this.storageManager.testConnection(connectionData);
      this.emit('connectionTested', { connectionData, result });
      return result;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  // Get available connections
  async getConnections() {
    try {
      const settings = await this.storageManager.getSettings();
      return settings.connections;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  async getActiveConnection() {
    try {
      return await this.storageManager.getActiveConnection();
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  // Fallback handling
  async sendMessageWithFallback(messageText, pageContext = null, options = {}) {
    const enabledConnections = await this.storageManager.getEnabledConnections();
    
    if (enabledConnections.length === 0) {
      throw new Error('No enabled connections available');
    }

    let lastError;
    
    for (const connection of enabledConnections) {
      try {
        // Temporarily set as active
        const originalActive = await this.storageManager.getActiveConnection();
        await this.storageManager.setActiveConnection(connection.id);
        
        const result = await this.sendMessage(messageText, pageContext, options);
        
        // Restore original active connection if different
        if (originalActive && originalActive.id !== connection.id) {
          await this.storageManager.setActiveConnection(originalActive.id);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`LLMManager: Connection ${connection.name} failed:`, error.message);
        continue;
      }
    }
    
    throw lastError || new Error('All connections failed');
  }

  // Event system
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.eventListeners.has(event)) {
      const callbacks = this.eventListeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventListeners.has(event)) {
      const callbacks = this.eventListeners.get(event);
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('LLMManager: Event callback error:', error);
        }
      });
    }
  }

  // Utility methods
  generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Cancel active request
  cancelRequest(requestId) {
    if (this.activeRequests.has(requestId)) {
      const request = this.activeRequests.get(requestId);
      if (request.controller) {
        request.controller.abort();
      }
      this.activeRequests.delete(requestId);
      this.emit('requestCancelled', { requestId });
    }
  }

  // Get manager status
  getStatus() {
    return {
      activeRequests: this.activeRequests.size,
      queueLength: this.requestQueue.length,
      isProcessingQueue: this.isProcessingQueue
    };
  }

  // Reset parser state
  resetParser() {
    this.streamParser.reset();
  }

  // Import/export settings
  async importSettings(settingsJson) {
    try {
      await this.storageManager.importSettings(settingsJson);
      this.emit('settingsImported');
      return true;
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }

  async exportSettings() {
    try {
      return await this.storageManager.exportSettings();
    } catch (error) {
      this.emit('error', { error: error.message });
      throw error;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LLMManager;
} else if (typeof globalThis !== 'undefined') {
  globalThis.LLMManager = LLMManager;
} else if (typeof self !== 'undefined') {
  self.LLMManager = LLMManager;
}