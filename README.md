# 🦙 LlamB Browser Extension

A Chrome extension that provides an AI chat sidebar for any webpage, allowing you to interact with LLMs while having full context of the current page.

## Features

- **Chat Sidebar**: Floating sidebar that appears on any webpage
- **Page Context Awareness**: AI has access to current page URL, title, and selected text
- **Multiple LLM Providers**: Support for OpenAI, Anthropic, Google, Ollama, and OpenRouter
- **Plugin System**: Extensible architecture with YouTube captions plugin
- **Chat History**: Persistent conversation management across sessions
- **Modern UI**: Clean, responsive design with light/dark theme support
- **Context Chips**: Smart page metadata extraction and display
- **Quick Actions**: Analyze pages, summarize selected text, and more

## Technical Architecture

### Sidebar Injection
The extension injects a chat sidebar directly into the DOM of any webpage using a content script. The sidebar is created dynamically via JavaScript and styled with CSS to appear as a floating overlay that doesn't interfere with the page layout. This approach ensures compatibility with all websites while maintaining full functionality.

### CORS Avoidance
The extension avoids Cross-Origin Resource Sharing (CORS) issues by using a smart architecture:

- **Content Script**: Runs in the webpage context and handles UI interactions
- **Background Service Worker**: Acts as a proxy for API calls to LLM providers
- **Message Passing**: Chrome's extension messaging API facilitates secure communication between content script and background worker

When you send a message to an AI, the content script forwards it to the background worker, which makes the actual API call to OpenAI, Anthropic, or other providers. The response is then streamed back to the content script and displayed in the sidebar. This design completely bypasses CORS restrictions since the API calls originate from the extension's background context, not the webpage.

### Plugin System
The extension features a modular plugin architecture that allows for site-specific functionality:

- **Base Plugin Class**: Provides common functionality and API access
- **Dynamic Loading**: Plugins are loaded via manifest content scripts to comply with Chrome's CSP
- **Context Chips**: Plugins can display contextual information as interactive chips in the sidebar
- **Site Detection**: Plugins automatically activate based on current webpage domain

## Installation

### Load as Unpacked Extension (Development)

1. **Download or Clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** by toggling the switch in the top right corner
4. **Click "Load unpacked"** and select the project folder (`LlambBrowserExt`)


## Usage

### Basic Usage

1. **Toggle Sidebar**: Click the extension icon in the toolbar or use the floating toggle button
2. **Chat**: Type messages in the chat input at the bottom of the sidebar
3. **Page Context**: The AI automatically knows what page you're on and can access selected text

### Quick Actions (via Popup)

1. **Click the extension icon** to open the popup
2. **Toggle Chat Sidebar**: Open/close the sidebar
3. **Analyze Current Page**: Get AI insights about the current webpage
4. **Summarize Selection**: Summarize any text you've selected on the page

### Settings

- **AI Model**: Choose between different AI models (GPT-3.5, GPT-4, Claude, etc.)
- **API Key**: Configure your API key for LLM access
- Access settings through the extension popup

## File Structure

```
LlambBrowserExt/
├── manifest.json              # Extension configuration
├── content.js                # Content script (injected into web pages)
├── sidebar.css               # Sidebar styling  
├── background.js             # Background service worker
├── popup.html               # Extension popup interface
├── popup.js                 # Popup functionality
├── settings.html            # Settings page interface
├── settings.js              # Settings page functionality
├── create_icons.html        # Icon generator utility
├── js/                      # Core modules
│   ├── storage-manager.js   # Local storage management
│   ├── chat-manager.js      # Chat persistence and management
│   ├── llm-manager.js       # LLM provider integration
│   ├── llm-providers.js     # Individual provider implementations
│   ├── stream-parser.js     # Response streaming utilities
│   ├── plugin-manager.js    # Plugin system management
│   └── plugin-base.js       # Base plugin class
├── plugins/                 # Plugin directory
│   └── youtube-captions/    # YouTube captions plugin
│       ├── plugin.js        # Plugin implementation
│       └── manifest.json    # Plugin metadata
├── icons/                   # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── DESIGN_SYSTEM.md        # UI design guidelines
├── PLUGIN_DEVELOPMENT.md   # Plugin development guide
└── README.md              # This file
```

## Current Status

✅ **Core Extension Complete**
- Chrome extension manifest and permissions
- Content script injection system with DOM sidebar creation
- Background service worker for API proxying (CORS avoidance)
- Modern UI with light/dark theme support
- Popup and settings interfaces

✅ **LLM Integration Complete**
- Multiple provider support (OpenAI, Anthropic, Google, Ollama, OpenRouter)
- Real-time streaming responses
- Connection management and API key handling
- Error handling and retry logic

✅ **Plugin System Complete**
- Extensible plugin architecture
- YouTube captions extraction plugin
- Context chip system for metadata display
- Dynamic plugin loading with CSP compliance

✅ **Chat Management Complete**
- Persistent chat history
- Session management across tabs
- Context preservation and restoration

## Plugin Development

The extension supports a modular plugin system that allows developers to create site-specific integrations. The YouTube captions plugin serves as a reference implementation.

### Creating a Plugin
1. Create a new directory under `plugins/your-plugin-name/`
2. Implement your plugin class extending `LlambPluginBase`
3. Add a `manifest.json` file with plugin metadata
4. Register your plugin in the main manifest.json

For detailed documentation on creating plugins, see [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md).

### Available Plugins
- **YouTube Captions**: Extracts and displays video captions as context chips for YouTube videos

## Next Steps

1. **Enhanced Context**: OCR for images, PDF reading, webpage text extraction
2. **More Plugins**: Additional site-specific integrations (GitHub, Stack Overflow, etc.)
3. **Customization**: Sidebar positioning, keyboard shortcuts, custom themes
4. **Export/Import**: Conversation export, settings backup/restore
5. **Advanced Features**: Voice input, image analysis, code execution

## Development

### Prerequisites
- Chrome browser (Manifest V3 compatible)
- Basic knowledge of JavaScript, HTML, CSS
- API keys for your chosen LLM provider
- Understanding of Chrome extension architecture

### Making Changes
1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Test your changes on various websites

### Recent Technical Improvements
The extension has been enhanced to handle Chrome's strict Content Security Policy (CSP) and context isolation:

- **CSP Compliance**: Plugin scripts are loaded via manifest content_scripts to avoid CSP eval errors
- **Context Isolation**: Proper handling of Chrome's isolated execution contexts between content scripts and webpage
- **Dynamic Loading**: Scripts are loaded dynamically with proper error handling and timing
- **Plugin Architecture**: Modular system that works within Chrome's security constraints

### Debugging
- **Content Script**: Use the webpage's developer console
- **Background Script**: Use the extension's service worker console in `chrome://extensions/`
- **Popup**: Right-click the extension icon and select "Inspect popup"
- **Plugin Issues**: Check console for plugin loading errors and context isolation problems

## Permissions Explained

- `activeTab`: Access the current webpage for context
- `storage`: Save user settings and preferences
- `scripting`: Inject the sidebar into web pages
- `<all_urls>`: Work on all websites

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Troubleshooting

**Sidebar not appearing?**
- Try refreshing the webpage
- Check if the extension is enabled in `chrome://extensions/`

**Extension icon not visible?**
- Make sure you've added the icon files to the `icons/` folder
- Refresh the extension in `chrome://extensions/`

**Chat not working?**
- LLM integration is still in development
- Currently shows placeholder responses for testing UI functionality

## Support

For issues, feature requests, or questions:
- Open an issue on GitHub
- Check the troubleshooting section above
- Review the Chrome extension developer documentation
