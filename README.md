# 🦙 LlamB Browser Extension

A Chrome extension that provides an AI chat sidebar for any webpage, allowing you to interact with LLMs while having full context of the current page.

## Features

- **Chat Sidebar**: Floating sidebar that appears on any webpage
- **Page Context Awareness**: AI has access to current page URL, title, and selected text
- **Modern UI**: Clean, responsive design that works on all websites
- **Quick Actions**: Analyze pages, summarize selected text, and more
- **Multiple AI Models**: Support for GPT-3.5, GPT-4, Claude 3, and more (coming soon)

## Installation

### Load as Unpacked Extension (Development)

1. **Download or Clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** by toggling the switch in the top right corner
4. **Click "Load unpacked"** and select the project folder (`LlambBrowserExt`)
5. **Add Icons**: Create and add icon files to the `icons/` folder:
   - `icon16.png` (16x16 pixels)
   - `icon48.png` (48x48 pixels) 
   - `icon128.png` (128x128 pixels)

### Create Icons

You can use the included `create_icons.html` file to generate icons:
1. Open `create_icons.html` in your browser
2. Download the generated PNG files
3. Place them in the `icons/` folder

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
├── manifest.json          # Extension configuration
├── content.js            # Content script (injected into web pages)
├── sidebar.css           # Sidebar styling
├── background.js         # Background service worker
├── popup.html           # Extension popup interface
├── popup.js             # Popup functionality
├── create_icons.html    # Icon generator utility
├── icons/               # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # This file
```

## Current Status

✅ **Phase 1 Complete**: Basic Extension Structure
- Chrome extension manifest and permissions
- Content script injection system
- Sidebar UI with modern styling
- Background script for extension logic
- Popup interface for quick actions

🚧 **Phase 2 In Progress**: LLM Integration
- API connection setup
- Model selection functionality
- Real AI responses (currently shows placeholder responses)
- Streaming responses
- Error handling and retry logic

## Next Steps

1. **Add LLM Integration**: Connect to OpenAI, Anthropic, or other AI APIs
2. **Implement Streaming**: Real-time response streaming
3. **Advanced Context**: OCR for images, PDF reading, etc.
4. **Customization**: Themes, sidebar position, keyboard shortcuts
5. **Export/Import**: Save conversations, export chats

## Development

### Prerequisites
- Chrome browser
- Basic knowledge of JavaScript, HTML, CSS
- API keys for your chosen LLM provider

### Making Changes
1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Test your changes

### Debugging
- **Content Script**: Use the webpage's developer console
- **Background Script**: Use the extension's service worker console in `chrome://extensions/`
- **Popup**: Right-click the extension icon and select "Inspect popup"

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