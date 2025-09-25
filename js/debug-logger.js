// Debug Logger - Centralized logging utility for LlamB extension
// This checks the user's debug logging preference from settings

class DebugLogger {
  constructor() {
    this.enabled = false;
    this.prefix = '[LlamB]';
    this.initPromise = this.loadDebugSetting();
  }

  // Load debug setting from storage
  async loadDebugSetting() {
    try {
      const result = await chrome.storage.local.get('llamb-settings');
      const settings = result['llamb-settings'] || {};
      this.enabled = settings.globalSettings?.debugLogging === true;
      return this.enabled;
    } catch (error) {
      // If we can't load settings, default to disabled
      this.enabled = false;
      return false;
    }
  }

  // Check if debug is enabled (async)
  async isEnabled() {
    await this.initPromise;
    return this.enabled;
  }

  // Update debug setting
  async updateDebugSetting(enabled) {
    this.enabled = enabled;
  }

  // Log methods that check the setting
  async log(...args) {
    if (await this.isEnabled()) {
      console.log(this.prefix, ...args);
    }
  }

  async warn(...args) {
    if (await this.isEnabled()) {
      console.warn(this.prefix, ...args);
    }
  }

  async info(...args) {
    if (await this.isEnabled()) {
      console.info(this.prefix, ...args);
    }
  }

  // Always show errors regardless of debug setting
  error(...args) {
    console.error(this.prefix, ...args);
  }

  // Synchronous versions that check cached setting (use after init)
  logSync(...args) {
    if (this.enabled) {
      console.log(this.prefix, ...args);
    }
  }

  warnSync(...args) {
    if (this.enabled) {
      console.warn(this.prefix, ...args);
    }
  }

  infoSync(...args) {
    if (this.enabled) {
      console.info(this.prefix, ...args);
    }
  }
}

// Create singleton instance
const debugLogger = new DebugLogger();

// Listen for setting changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['llamb-settings']) {
    const newSettings = changes['llamb-settings'].newValue;
    if (newSettings?.globalSettings?.debugLogging !== undefined) {
      debugLogger.updateDebugSetting(newSettings.globalSettings.debugLogging);
    }
  }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = debugLogger;
}