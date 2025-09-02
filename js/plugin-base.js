// Plugin Base Class - Standard interface that all plugins must implement
class LlambPluginBase {
  constructor(api, manifest) {
    this.api = api;
    this.manifest = manifest;
    this.id = manifest.id;
    this.name = manifest.name;
    this.isActive = false;
    this.contextChip = null;
  }

  // ============================================
  // LIFECYCLE HOOKS - Override in your plugin
  // ============================================

  /**
   * Called when plugin is first loaded
   * Use this for one-time initialization
   */
  onInit() {
    this.api.log('Plugin initialized');
  }

  /**
   * Called when plugin is enabled/activated
   * Use this to start monitoring page changes, add UI elements, etc.
   */
  onActivate() {
    this.isActive = true;
    this.api.log('Plugin activated');
    this.checkAndAddContextChip();
  }

  /**
   * Called when plugin is disabled/deactivated
   * Use this to clean up event listeners, remove UI elements, etc.
   */
  onDeactivate() {
    this.isActive = false;
    this.api.log('Plugin deactivated');
    this.removeContextChip();
  }

  /**
   * Called when navigating to a new page
   * Use this to detect page changes and update plugin behavior
   */
  async onPageChange() {
    if (this.isActive) {
      this.api.log('Page changed:', this.api.getPageContext().url);
      this.checkAndAddContextChip();
    }
  }

  // ============================================
  // ABSTRACT METHODS - Must implement in plugin
  // ============================================

  /**
   * Check if this plugin should run on the current page
   * @returns {boolean} True if plugin should be active on current page
   */
  shouldRunOnCurrentPage() {
    throw new Error('Plugin must implement shouldRunOnCurrentPage()');
  }

  /**
   * Get the content that this plugin extracts from the current page
   * This content will be included in the chat context when the plugin's chip is active
   * @returns {Promise<string|null>} Extracted content or null if not available
   */
  async getContent() {
    throw new Error('Plugin must implement getContent()');
  }

  /**
   * Get detailed content for modal display
   * This is called when user clicks on the plugin chip to see full content
   * Should include debugging info, metadata, and full content details
   * @returns {Promise<string|null>} Detailed content or null if not available
   */
  async getDetailedContent() {
    // Default implementation delegates to getContent
    const content = await this.getContent();
    if (!content) return null;

    const pageContext = this.getPageContext();
    let detailedContent = `# ${this.name}\n\n`;
    
    // Add plugin metadata
    detailedContent += `## Plugin Information\n\n`;
    detailedContent += `- **Name:** ${this.manifest.name}\n`;
    detailedContent += `- **Version:** ${this.manifest.version}\n`;
    detailedContent += `- **ID:** ${this.id}\n`;
    detailedContent += `- **Status:** ${this.isActive ? 'Active' : 'Inactive'}\n\n`;
    
    // Add page information
    detailedContent += `## Page Context\n\n`;
    detailedContent += `- **URL:** ${pageContext.url}\n`;
    detailedContent += `- **Title:** ${pageContext.title}\n`;
    detailedContent += `- **Domain:** ${pageContext.domain}\n`;
    detailedContent += `- **Timestamp:** ${pageContext.timestamp}\n\n`;
    
    // Add extracted content
    detailedContent += `## Extracted Content\n\n`;
    detailedContent += content;
    
    return detailedContent;
  }

  /**
   * Get the context chip data for this plugin
   * @returns {Object|null} Chip data object or null if no chip should be shown
   */
  getContextChipData() {
    throw new Error('Plugin must implement getContextChipData()');
  }

  // ============================================
  // HELPER METHODS - Available to all plugins
  // ============================================

  /**
   * Check current page and add context chip if appropriate
   */
  async checkAndAddContextChip() {
    if (!this.shouldRunOnCurrentPage()) {
      this.removeContextChip();
      return;
    }

    const chipData = this.getContextChipData();
    if (chipData && !this.contextChip) {
      this.addContextChip(chipData);
    }
  }

  /**
   * Add context chip to the UI
   * @param {Object} chipData - Chip configuration
   */
  addContextChip(chipData) {
    if (this.contextChip) {
      this.removeContextChip();
    }

    const fullChipData = {
      id: this.id,
      pluginId: this.id,
      icon: chipData.icon || this.manifest.icon || '🔧',
      text: chipData.text || this.name,
      description: chipData.description || this.manifest.description,
      isActive: false,
      ...chipData
    };

    this.contextChip = fullChipData;
    this.api.addContextChip(fullChipData);
    this.api.log('Added context chip:', fullChipData.text);
  }

  /**
   * Remove context chip from the UI
   */
  removeContextChip() {
    if (this.contextChip) {
      this.api.removeContextChip();
      this.contextChip = null;
      this.api.log('Removed context chip');
    }
  }

  /**
   * Get current page context
   * @returns {Object} Page context object
   */
  getPageContext() {
    return this.api.getPageContext();
  }

  /**
   * Check if current URL matches any of the patterns
   * @param {string[]} patterns - Array of URL patterns (glob style)
   * @returns {boolean} True if URL matches any pattern
   */
  urlMatches(patterns) {
    const currentUrl = window.location.href;
    return patterns.some(pattern => {
      const regex = new RegExp(
        pattern.replace(/\*/g, '.*').replace(/\./g, '\\.')
      );
      return regex.test(currentUrl);
    });
  }

  /**
   * Get domain from current URL
   * @returns {string} Current domain
   */
  getCurrentDomain() {
    return window.location.hostname;
  }

  /**
   * Check if we're on a specific domain
   * @param {string|string[]} domains - Domain(s) to check
   * @returns {boolean} True if on specified domain(s)
   */
  isOnDomain(domains) {
    const currentDomain = this.getCurrentDomain();
    const domainList = Array.isArray(domains) ? domains : [domains];
    return domainList.some(domain => currentDomain.includes(domain));
  }

  /**
   * Wait for an element to appear in the DOM
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<Element|null>} The element or null if timeout
   */
  async waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          clearTimeout(timeoutId);
          resolve(element);
        }
      });

      const timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }

  /**
   * Safely execute async operation with error handling
   * @param {Function} operation - Async operation to execute
   * @param {string} operationName - Name for logging
   * @returns {Promise<any>} Result or null on error
   */
  async safeAsyncOperation(operation, operationName = 'operation') {
    try {
      return await operation();
    } catch (error) {
      this.api.error(`Failed to execute ${operationName}:`, error);
      return null;
    }
  }

  /**
   * Debounce function calls
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @returns {Function} Debounced function
   */
  debounce(func, wait) {
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

  /**
   * Format content for markdown inclusion
   * @param {string} content - Raw content
   * @param {Object} options - Formatting options
   * @returns {string} Formatted content
   */
  formatContentForChat(content, options = {}) {
    const {
      title = '',
      type = 'content',
      maxLength = 10000,
      includeMetadata = true
    } = options;

    let formatted = '';
    
    if (includeMetadata && title) {
      formatted += `## ${title}\n\n`;
    }

    // Truncate if too long
    let processedContent = content;
    if (content.length > maxLength) {
      processedContent = content.substring(0, maxLength) + '\n\n[Content truncated...]';
    }

    formatted += processedContent;

    if (includeMetadata) {
      const pageContext = this.getPageContext();
      formatted += `\n\n*Source: ${pageContext.url}*`;
      formatted += `\n*Extracted by: ${this.name}*`;
      formatted += `\n*Timestamp: ${pageContext.timestamp}*`;
    }

    return formatted;
  }

  // ============================================
  // SETTINGS HELPERS
  // ============================================

  /**
   * Get plugin setting value
   * @param {string} key - Setting key
   * @param {any} defaultValue - Default value if not set
   * @returns {any} Setting value
   */
  getSetting(key, defaultValue = null) {
    const value = this.api.getSetting(key);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Set plugin setting value
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {Promise<void>}
   */
  async setSetting(key, value) {
    await this.api.setSetting(key, value);
  }

  // ============================================
  // EVENT HELPERS
  // ============================================

  /**
   * Emit a plugin event
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  emit(event, data) {
    this.api.emit(event, data);
  }

  /**
   * Listen to a plugin event
   * @param {string} event - Event name
   * @param {Function} callback - Event callback
   */
  on(event, callback) {
    this.api.on(event, callback);
  }

  // ============================================
  // LOGGING HELPERS
  // ============================================

  log(...args) {
    this.api.log(...args);
  }

  warn(...args) {
    this.api.warn(...args);
  }

  error(...args) {
    this.api.error(...args);
  }
}

// Export for use in content script
console.log('LlambPluginBase: Making class available globally');
window.LlambPluginBase = LlambPluginBase;