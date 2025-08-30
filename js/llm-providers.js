// LLM Providers - Handle different API implementations
class LLMProviders {
  constructor() {
    this.providers = {
      'openai': new OpenAIProvider(),
      'openai-compatible': new OpenAICompatibleProvider(),
      'anthropic': new AnthropicProvider()
    };
  }

  getProvider(type) {
    return this.providers[type] || this.providers['openai-compatible'];
  }

  listProviders() {
    return Object.keys(this.providers);
  }
}

// Base provider class
class BaseProvider {
  constructor() {
    this.name = 'Base';
    this.supportedFeatures = {
      streaming: false,
      reasoning: false,
      thinking: false,
      functionCalling: false,
      vision: false
    };
  }

  async sendMessage(connection, messages, options = {}) {
    throw new Error('sendMessage must be implemented by provider');
  }

  async sendStreamingMessage(connection, messages, options = {}) {
    throw new Error('sendStreamingMessage must be implemented by provider');
  }

  validateConnection(connection) {
    if (!connection.endpoint) {
      throw new Error('Endpoint is required');
    }
    return true;
  }

  formatMessages(messages, connection) {
    return messages;
  }

  buildRequestBody(connection, messages, options) {
    return {
      model: connection.model,
      messages: this.formatMessages(messages, connection),
      max_tokens: options.maxTokens || 4000,
      temperature: options.temperature || 0.7,
      stream: options.streaming || false
    };
  }

  buildHeaders(connection) {
    const headers = {
      'Content-Type': 'application/json',
      ...connection.customHeaders
    };

    if (connection.apiKey) {
      headers['Authorization'] = `Bearer ${connection.apiKey}`;
    }

    return headers;
  }
}

// OpenAI provider
class OpenAIProvider extends BaseProvider {
  constructor() {
    super();
    this.name = 'OpenAI';
    this.supportedFeatures = {
      streaming: true,
      reasoning: false,
      thinking: false,
      functionCalling: true,
      vision: true
    };
  }

  validateConnection(connection) {
    super.validateConnection(connection);
    
    if (!connection.apiKey && connection.endpoint.includes('api.openai.com')) {
      throw new Error('API key is required for OpenAI');
    }

    if (!connection.model) {
      throw new Error('Model is required');
    }

    return true;
  }

  async sendMessage(connection, messages, options = {}) {
    this.validateConnection(connection);

    const requestBody = this.buildRequestBody(connection, messages, options);
    const headers = this.buildHeaders(connection);

    try {
      const response = await fetch(`${connection.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(connection.timeout || 30000)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return this.formatResponse(data);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  async sendStreamingMessage(connection, messages, options = {}) {
    console.log('OpenAIProvider: Starting sendStreamingMessage');
    this.validateConnection(connection);

    const requestBody = this.buildRequestBody(connection, messages, { ...options, streaming: true });
    const headers = this.buildHeaders(connection);
    const url = `${connection.endpoint}/chat/completions`;

    console.log('OpenAIProvider: Request URL:', url);
    console.log('OpenAIProvider: Request headers:', headers);
    console.log('OpenAIProvider: Request body:', JSON.stringify(requestBody, null, 2));

    try {
      console.log('OpenAIProvider: Making fetch request...');
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      console.log('OpenAIProvider: Response status:', response.status);
      console.log('OpenAIProvider: Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAIProvider: Error response:', errorText);
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      console.log('OpenAIProvider: Success! Returning response body');
      return response.body;
    } catch (error) {
      console.error('OpenAIProvider: Fetch error:', error);
      throw error;
    }
  }

  formatResponse(data) {
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response choices received');
    }

    const choice = data.choices[0];
    return {
      content: choice.message.content,
      finishReason: choice.finish_reason,
      usage: data.usage,
      model: data.model
    };
  }
}

// OpenAI-compatible provider (Ollama, LM Studio, etc.)
class OpenAICompatibleProvider extends OpenAIProvider {
  constructor() {
    super();
    this.name = 'OpenAI Compatible';
    this.supportedFeatures = {
      streaming: true,
      reasoning: true,  // Many local models support reasoning
      thinking: true,   // Many local models support thinking
      functionCalling: false, // Varies by model
      vision: false     // Varies by model
    };
  }

  validateConnection(connection) {
    // Don't require API key for local models
    if (!connection.endpoint) {
      throw new Error('Endpoint is required');
    }

    if (!connection.model) {
      throw new Error('Model is required');
    }

    return true;
  }

  buildRequestBody(connection, messages, options) {
    const body = super.buildRequestBody(connection, messages, options);
    
    // Some local models need different parameters
    if (connection.features?.contextWindow) {
      body.max_tokens = Math.min(body.max_tokens, connection.features.contextWindow);
    }

    // Add reasoning/thinking instructions if supported
    if (connection.features?.reasoning && options.enableReasoning) {
      body.system = (body.system || '') + '\n\nWhen needed, use <reasoning></reasoning> tags to show your thought process.';
    }

    if (connection.features?.thinking && options.enableThinking) {
      body.system = (body.system || '') + '\n\nWhen needed, use <thinking></thinking> tags for internal thoughts.';
    }

    return body;
  }

  async sendMessage(connection, messages, options = {}) {
    try {
      return await super.sendMessage(connection, messages, options);
    } catch (error) {
      // Try fallback for different endpoint formats
      if (error.message.includes('404') && !connection.endpoint.includes('/v1')) {
        const fallbackConnection = {
          ...connection,
          endpoint: connection.endpoint.replace(/\/+$/, '') + '/v1'
        };
        return await super.sendMessage(fallbackConnection, messages, options);
      }
      throw error;
    }
  }
}

// Anthropic provider (future implementation)
class AnthropicProvider extends BaseProvider {
  constructor() {
    super();
    this.name = 'Anthropic';
    this.supportedFeatures = {
      streaming: true,
      reasoning: true,
      thinking: true,
      functionCalling: false,
      vision: true
    };
  }

  validateConnection(connection) {
    super.validateConnection(connection);
    
    if (!connection.apiKey) {
      throw new Error('API key is required for Anthropic');
    }

    if (!connection.model) {
      throw new Error('Model is required');
    }

    return true;
  }

  buildHeaders(connection) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': connection.apiKey,
      'anthropic-version': '2023-06-01',
      ...connection.customHeaders
    };
  }

  formatMessages(messages, connection) {
    // Anthropic has a different message format
    const formattedMessages = [];
    let systemMessage = '';

    for (const message of messages) {
      if (message.role === 'system') {
        systemMessage += message.content + '\n';
      } else {
        formattedMessages.push({
          role: message.role,
          content: message.content
        });
      }
    }

    return { messages: formattedMessages, system: systemMessage.trim() };
  }

  buildRequestBody(connection, messages, options) {
    const formatted = this.formatMessages(messages, connection);
    
    const body = {
      model: connection.model,
      messages: formatted.messages,
      max_tokens: options.maxTokens || 4000,
      temperature: options.temperature || 0.7,
      stream: options.streaming || false
    };

    if (formatted.system) {
      body.system = formatted.system;
    }

    return body;
  }

  async sendMessage(connection, messages, options = {}) {
    this.validateConnection(connection);

    const requestBody = this.buildRequestBody(connection, messages, options);
    const headers = this.buildHeaders(connection);

    try {
      const response = await fetch(`${connection.endpoint}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(connection.timeout || 30000)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return this.formatResponse(data);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  async sendStreamingMessage(connection, messages, options = {}) {
    // Similar to sendMessage but with streaming enabled
    const requestBody = this.buildRequestBody(connection, messages, { ...options, streaming: true });
    const headers = this.buildHeaders(connection);

    const response = await fetch(`${connection.endpoint}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    return response.body;
  }

  formatResponse(data) {
    if (!data.content || data.content.length === 0) {
      throw new Error('No content received');
    }

    return {
      content: data.content[0].text,
      finishReason: data.stop_reason,
      usage: data.usage,
      model: data.model
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LLMProviders, BaseProvider, OpenAIProvider, OpenAICompatibleProvider, AnthropicProvider };
} else if (typeof globalThis !== 'undefined') {
  globalThis.LLMProviders = LLMProviders;
  globalThis.BaseProvider = BaseProvider;
  globalThis.OpenAIProvider = OpenAIProvider;
  globalThis.OpenAICompatibleProvider = OpenAICompatibleProvider;
  globalThis.AnthropicProvider = AnthropicProvider;
} else if (typeof self !== 'undefined') {
  self.LLMProviders = LLMProviders;
  self.BaseProvider = BaseProvider;
  self.OpenAIProvider = OpenAIProvider;
  self.OpenAICompatibleProvider = OpenAICompatibleProvider;
  self.AnthropicProvider = AnthropicProvider;
}