# LlamB Extension Plugin Development Guide

This guide explains how to create custom plugins for the LlamB browser extension. Plugins allow you to extend the extension's functionality to extract content from specific websites or add custom features.

## Table of Contents

1. [Plugin Architecture Overview](#plugin-architecture-overview)
2. [Getting Started](#getting-started)
3. [Plugin Structure](#plugin-structure)
4. [API Reference](#api-reference)
5. [Best Practices](#best-practices)
6. [Examples](#examples)
7. [Testing and Debugging](#testing-and-debugging)

## Plugin Architecture Overview

The LlamB plugin system provides a secure, sandboxed environment for extending functionality. Key components:

- **PluginManager**: Core system that handles plugin lifecycle, loading, and communication
- **LlambPluginBase**: Base class that all plugins must extend
- **Plugin API**: Controlled interface for plugins to interact with the extension
- **Context Chips**: UI elements that plugins can add to show available content

## Getting Started

### Prerequisites

- Basic knowledge of JavaScript ES6+
- Understanding of browser extension development
- Familiarity with the LlamB extension structure

### Creating Your First Plugin

1. **Create plugin directory structure:**
   ```
   plugins/
   └── my-plugin/
       ├── plugin.js
       └── manifest.json
   ```

2. **Write the plugin manifest:**
   ```json
   {
     "id": "my-plugin",
     "name": "My Plugin",
     "description": "Description of what your plugin does",
     "version": "1.0.0",
     "author": "Your Name",
     "icon": "🔧",
     "matches": [
       "*://example.com/*"
     ],
     "permissions": [
       "extractContent"
     ],
     "settings": {
       "enableFeature": {
         "type": "boolean",
         "label": "Enable Feature",
         "default": true
       }
     }
   }
   ```

3. **Implement the plugin class:**
   ```javascript
   class MyPlugin extends LlambPluginBase {
     shouldRunOnCurrentPage() {
       return this.isOnDomain('example.com');
     }

     async getContent() {
       // Extract and return content
       return "Extracted content from the page";
     }

     getContextChipData() {
       return {
         icon: '🔧',
         text: 'My Plugin',
         description: 'Extract custom content'
       };
     }
   }

   // Make plugin available globally
   window.MyPlugin = MyPlugin;
   ```

## Plugin Structure

### Directory Layout
```
plugins/
└── plugin-name/
    ├── plugin.js          # Main plugin implementation
    ├── manifest.json      # Plugin configuration
    ├── README.md         # Plugin documentation (optional)
    └── assets/           # Icons, images, etc. (optional)
        └── icon.svg
```

### Manifest.json Schema

```json
{
  "id": "string",                    // Unique plugin identifier
  "name": "string",                  // Human-readable name
  "description": "string",           // Plugin description
  "version": "string",               // Semantic version (e.g., "1.0.0")
  "author": "string",                // Plugin author
  "icon": "string",                  // Icon (emoji or HTML/SVG)
  "matches": ["string"],             // URL patterns where plugin runs
  "permissions": ["string"],         // Required permissions
  "settings": {                      // Plugin settings schema
    "settingKey": {
      "type": "boolean|string|number|select",
      "label": "string",
      "default": "any",
      "options": [                   // For select type
        {"value": "val", "label": "Label"}
      ],
      "description": "string"
    }
  },
  "requirements": {                  // System requirements
    "domains": ["string"],
    "javascript": true
  }
}
```

### Plugin Class Structure

```javascript
class YourPlugin extends LlambPluginBase {
  constructor(api, manifest) {
    super(api, manifest);
    // Initialize your plugin
  }

  // === Required Methods ===
  
  shouldRunOnCurrentPage() {
    // Return true if plugin should be active on current page
  }

  async getContent() {
    // Extract and return content for chat context
  }

  getContextChipData() {
    // Return chip configuration object
  }

  // === Optional Lifecycle Hooks ===
  
  onInit() {
    // Called when plugin is first loaded
  }

  onActivate() {
    // Called when plugin is enabled
  }

  onDeactivate() {
    // Called when plugin is disabled
  }

  async onPageChange() {
    // Called when navigating to a new page
  }
}

// Export plugin
window.YourPlugin = YourPlugin;
```

## API Reference

### Plugin API Object

The plugin API provides controlled access to extension functionality:

#### Identification
- `getPluginId()`: Get the plugin's unique ID
- `getManifest()`: Get the plugin's manifest object

#### Settings Management
- `getSetting(key)`: Get a setting value
- `setSetting(key, value)`: Set a setting value (async)

#### Page Context
- `getPageContext()`: Get current page information

#### UI Integration
- `addContextChip(chipData)`: Add a context chip to the UI
- `removeContextChip()`: Remove the plugin's context chip

#### Event System
- `emit(event, data)`: Emit a plugin event
- `on(event, callback)`: Listen to plugin events

#### Logging
- `log(...args)`: Log information
- `warn(...args)`: Log warnings
- `error(...args)`: Log errors

#### Storage
- `storage.get(key)`: Get plugin-scoped storage value (async)
- `storage.set(key, value)`: Set plugin-scoped storage value (async)

### Base Class Helper Methods

#### Page Detection
- `urlMatches(patterns)`: Check if current URL matches patterns
- `getCurrentDomain()`: Get current domain
- `isOnDomain(domains)`: Check if on specific domain(s)

#### DOM Utilities
- `waitForElement(selector, timeout)`: Wait for element to appear
- `safeAsyncOperation(operation, name)`: Execute with error handling
- `debounce(func, wait)`: Debounce function calls

#### Content Formatting
- `formatContentForChat(content, options)`: Format content for chat inclusion

#### Settings Helpers
- `getSetting(key, defaultValue)`: Get setting with default
- `setSetting(key, value)`: Set setting value

### Context Chip Configuration

```javascript
{
  icon: 'string',           // Icon (emoji or HTML/SVG)
  text: 'string',           // Chip display text
  description: 'string',    // Tooltip description
  status: 'loading|ready',  // Status indicator
  isActive: boolean         // Whether chip is active
}
```

## Best Practices

### 1. Performance
- **Cache extracted content** to avoid re-extraction on page changes
- **Use debouncing** for frequent operations
- **Implement proper cleanup** in onDeactivate()
- **Handle large content** gracefully (truncate if needed)

### 2. Error Handling
- **Always use try-catch** in async operations
- **Provide meaningful error messages** for debugging
- **Fail gracefully** when content is not available
- **Use safeAsyncOperation()** for critical operations

### 3. Security
- **Validate all inputs** from page content
- **Sanitize HTML content** before processing
- **Don't expose sensitive data** in logs
- **Follow least privilege principle** for permissions

### 4. User Experience
- **Provide clear chip descriptions** for user understanding
- **Show loading states** when extracting content
- **Handle edge cases** (empty content, network errors)
- **Respect user settings** and preferences

### 5. Code Quality
- **Use meaningful variable names** and comments
- **Follow consistent coding style**
- **Keep functions focused** on single responsibilities
- **Document complex logic** with comments

## Examples

### Example 1: GitHub Repository Plugin

```javascript
class GithubRepositoryPlugin extends LlambPluginBase {
  shouldRunOnCurrentPage() {
    return this.isOnDomain('github.com') && 
           window.location.pathname.match(/^\/[^\/]+\/[^\/]+\/?$/);
  }

  async getContent() {
    const repoInfo = this.extractRepositoryInfo();
    const readme = await this.extractReadme();
    
    return this.formatContentForChat(
      `# ${repoInfo.name}\n\n${repoInfo.description}\n\n${readme}`,
      {
        title: `GitHub Repository: ${repoInfo.name}`,
        type: 'repository'
      }
    );
  }

  getContextChipData() {
    return {
      icon: `<svg><!-- GitHub icon --></svg>`,
      text: 'Repository Info',
      description: 'Extract GitHub repository information and README'
    };
  }

  extractRepositoryInfo() {
    const name = document.querySelector('h1[itemprop="name"]')?.textContent?.trim();
    const description = document.querySelector('p[itemprop="about"]')?.textContent?.trim();
    
    return { name, description };
  }

  async extractReadme() {
    const readmeElement = document.querySelector('#readme');
    return readmeElement ? readmeElement.textContent : '';
  }
}

window.GithubRepositoryPlugin = GithubRepositoryPlugin;
```

### Example 2: Twitter Thread Plugin

```javascript
class TwitterThreadPlugin extends LlambPluginBase {
  constructor(api, manifest) {
    super(api, manifest);
    this.threadCache = null;
  }

  shouldRunOnCurrentPage() {
    return this.isOnDomain('twitter.com') && 
           window.location.pathname.includes('/status/');
  }

  async getContent() {
    if (!this.threadCache) {
      this.threadCache = await this.extractThread();
    }
    
    return this.threadCache;
  }

  getContextChipData() {
    return {
      icon: '🐦',
      text: 'Thread',
      description: 'Extract Twitter thread'
    };
  }

  async extractThread() {
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    let threadContent = '';
    
    tweets.forEach((tweet, index) => {
      const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent;
      if (text) {
        threadContent += `${index + 1}. ${text}\n\n`;
      }
    });
    
    return this.formatContentForChat(threadContent, {
      title: 'Twitter Thread',
      type: 'thread'
    });
  }

  async onPageChange() {
    super.onPageChange();
    this.threadCache = null; // Clear cache on navigation
  }
}

window.TwitterThreadPlugin = TwitterThreadPlugin;
```

## Testing and Debugging

### Development Setup

1. **Enable extension developer mode** in your browser
2. **Load the extension** from the source directory
3. **Open browser developer tools** on pages where your plugin runs
4. **Check console logs** for plugin activity

### Debugging Tips

1. **Use console logging** liberally during development:
   ```javascript
   this.log('Plugin activated on:', this.getPageContext().url);
   ```

2. **Test error conditions**:
   ```javascript
   async getContent() {
     try {
       return await this.extractContent();
     } catch (error) {
       this.error('Failed to extract content:', error);
       return null;
     }
   }
   ```

3. **Validate plugin registration**:
   ```javascript
   // Check if plugin is loaded
   console.log('Available plugins:', Object.keys(window).filter(k => k.endsWith('Plugin')));
   ```

4. **Test context chip functionality**:
   - Click chips to verify they toggle correctly
   - Check if content appears in chat when chip is active

### Common Issues and Solutions

**Plugin not loading:**
- Check manifest.json syntax
- Verify plugin file is in web_accessible_resources
- Check console for script loading errors

**Context chip not appearing:**
- Verify shouldRunOnCurrentPage() returns true
- Check getContextChipData() returns valid object
- Ensure onPageChange() is called

**Content not extracted:**
- Test getContent() method independently
- Check for DOM timing issues (use waitForElement)
- Verify selectors match current page structure

**Settings not working:**
- Check manifest.json settings schema
- Test getSetting() and setSetting() methods
- Verify storage permissions

## Plugin Registration

### Manual Registration (Development)

During development, you can manually register plugins:

```javascript
// In console or content script
if (window.pluginManager) {
  pluginManager.registerPlugin({
    id: 'my-plugin',
    name: 'My Plugin',
    scriptPath: 'plugins/my-plugin/plugin.js',
    // ... rest of manifest
  });
  
  pluginManager.enablePlugin('my-plugin');
}
```

### Automatic Registration (Production)

For production plugins, add them to the PluginManager's `discoverPlugins()` method:

```javascript
// In plugin-manager.js
async discoverPlugins() {
  // Register your plugin
  this.registerPlugin({
    id: 'my-plugin',
    name: 'My Plugin',
    scriptPath: 'plugins/my-plugin/plugin.js',
    // ... manifest data
  });
}
```

## Advanced Features

### Custom Settings UI

Create complex settings interfaces by extending the base settings system:

```javascript
// In your plugin
getSettingsUI() {
  return `
    <div class="plugin-settings">
      <label>
        <input type="checkbox" id="feature-enabled">
        Enable Advanced Feature
      </label>
    </div>
  `;
}
```

### Inter-Plugin Communication

Plugins can communicate through the event system:

```javascript
// Plugin A emits event
this.emit('data-extracted', { content: extractedData });

// Plugin B listens for event
this.on('data-extracted', (event) => {
  console.log('Received data:', event.detail.content);
});
```

### Dynamic Content Updates

For pages with dynamic content, set up observers:

```javascript
onActivate() {
  super.onActivate();
  
  this.observer = new MutationObserver(() => {
    this.debounce(() => this.updateContent(), 500)();
  });
  
  this.observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

onDeactivate() {
  super.onDeactivate();
  
  if (this.observer) {
    this.observer.disconnect();
    this.observer = null;
  }
}
```

---

## Contributing

To contribute a plugin to the main LlamB extension:

1. **Follow this development guide**
2. **Test thoroughly** on target websites
3. **Document your plugin** with clear README
4. **Submit a pull request** with plugin files and tests
5. **Provide examples** of extracted content

## Support

For plugin development support:
- Check the extension's GitHub issues
- Review existing plugin implementations
- Test with browser developer tools
- Validate against this documentation

Happy plugin development! 🚀