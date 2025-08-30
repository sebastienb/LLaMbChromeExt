// Content script - injected into every webpage
(function() {
  'use strict';

  // Prevent multiple injections
  if (window.llambChatInjected) {
    return;
  }
  window.llambChatInjected = true;

  let sidebar = null;
  let isVisible = false;
  let preservedSelections = []; // Array to store multiple selections
  let selectionCounter = 0;

  // Cache for page content to avoid re-extraction
  let pageContentCache = {
    url: null,
    content: null,
    timestamp: null
  };

  // Theme management
  let currentTheme = null;

  function getPreferredTheme() {
    // Check if user has manually set a theme
    const storedTheme = localStorage.getItem('llamb-theme');
    if (storedTheme) {
      return storedTheme;
    }
    
    // Fall back to system preference
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-llamb-theme', theme);
    
    if (sidebar) {
      sidebar.setAttribute('data-llamb-theme', theme);
    }

    // Update theme button title
    const themeBtn = document.getElementById('llamb-theme-btn');
    if (themeBtn) {
      themeBtn.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
    }
  }

  function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('llamb-theme', newTheme);
    applyTheme(newTheme);
  }

  // Theme detection and application
  function detectAndApplyTheme() {
    const preferredTheme = getPreferredTheme();
    applyTheme(preferredTheme);
  }

  // Listen for theme changes (only if user hasn't manually set a theme)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      // Only auto-update if user hasn't manually set a theme
      if (!localStorage.getItem('llamb-theme')) {
        detectAndApplyTheme();
      }
    });
  }

  // Capture and preserve text selection
  function captureSelection() {
    const selection = window.getSelection().toString().trim();
    if (selection && !isSelectionAlreadyPreserved(selection)) {
      const selectionObj = {
        id: `selection-${Date.now()}-${selectionCounter++}`,
        text: selection,
        timestamp: new Date().toISOString()
      };
      preservedSelections.push(selectionObj);
      console.log('LlamB: Captured selection:', selectionObj);
    }
    return selection;
  }

  // Check if selection is already preserved
  function isSelectionAlreadyPreserved(text) {
    return preservedSelections.some(sel => sel.text === text);
  }

  // Clear all preserved selections
  function clearAllSelections() {
    preservedSelections = [];
    updateContextChips();
  }

  // Remove specific selection by id
  function removeSelection(selectionId) {
    preservedSelections = preservedSelections.filter(sel => sel.id !== selectionId);
    updateContextChips();
  }

  // Truncate text for display
  function truncateText(text, maxLength) {
    return text.length > maxLength 
      ? text.substring(0, maxLength) + '...' 
      : text;
  }

  // HTML to Markdown converter
  function htmlToMarkdown(element) {
    if (!element) return '';
    
    // Handle text nodes
    if (element.nodeType === Node.TEXT_NODE) {
      return element.textContent.trim();
    }
    
    // Skip script, style, and other non-content elements
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK'].includes(element.tagName)) {
      return '';
    }
    
    let markdown = '';
    const tagName = element.tagName?.toLowerCase();
    
    switch (tagName) {
      case 'h1':
        markdown = `# ${element.textContent.trim()}\n\n`;
        break;
      case 'h2':
        markdown = `## ${element.textContent.trim()}\n\n`;
        break;
      case 'h3':
        markdown = `### ${element.textContent.trim()}\n\n`;
        break;
      case 'h4':
        markdown = `#### ${element.textContent.trim()}\n\n`;
        break;
      case 'h5':
        markdown = `##### ${element.textContent.trim()}\n\n`;
        break;
      case 'h6':
        markdown = `###### ${element.textContent.trim()}\n\n`;
        break;
      case 'p':
        const pContent = Array.from(element.childNodes).map(child => htmlToMarkdown(child)).join('');
        markdown = pContent.trim() ? `${pContent.trim()}\n\n` : '';
        break;
      case 'br':
        markdown = '\n';
        break;
      case 'strong':
      case 'b':
        markdown = `**${element.textContent.trim()}**`;
        break;
      case 'em':
      case 'i':
        markdown = `*${element.textContent.trim()}*`;
        break;
      case 'code':
        markdown = `\`${element.textContent.trim()}\``;
        break;
      case 'pre':
        const codeElement = element.querySelector('code');
        const codeText = codeElement ? codeElement.textContent : element.textContent;
        markdown = `\`\`\`\n${codeText.trim()}\n\`\`\`\n\n`;
        break;
      case 'a':
        const href = element.getAttribute('href');
        const linkText = element.textContent.trim();
        if (href && linkText) {
          // Convert relative URLs to absolute
          const absoluteUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
          markdown = `[${linkText}](${absoluteUrl})`;
        } else {
          markdown = linkText;
        }
        break;
      case 'img':
        const src = element.getAttribute('src');
        const alt = element.getAttribute('alt') || '';
        if (src) {
          const absoluteSrc = src.startsWith('http') ? src : new URL(src, window.location.href).href;
          markdown = `![${alt}](${absoluteSrc})\n\n`;
        }
        break;
      case 'ul':
      case 'ol':
        const listItems = Array.from(element.children).filter(child => child.tagName === 'LI');
        listItems.forEach((li, index) => {
          const prefix = tagName === 'ul' ? '- ' : `${index + 1}. `;
          const itemContent = Array.from(li.childNodes).map(child => htmlToMarkdown(child)).join('');
          markdown += `${prefix}${itemContent.trim()}\n`;
        });
        markdown += '\n';
        break;
      case 'blockquote':
        const quoteContent = Array.from(element.childNodes).map(child => htmlToMarkdown(child)).join('');
        markdown = quoteContent.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
        break;
      case 'table':
        // Simple table conversion - just extract text content
        const rows = Array.from(element.querySelectorAll('tr'));
        rows.forEach((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          const cellTexts = cells.map(cell => cell.textContent.trim());
          markdown += `| ${cellTexts.join(' | ')} |\n`;
          
          // Add header separator after first row
          if (rowIndex === 0 && cells.length > 0) {
            markdown += `|${' --- |'.repeat(cells.length)}\n`;
          }
        });
        markdown += '\n';
        break;
      default:
        // For other elements, process children
        Array.from(element.childNodes).forEach(child => {
          markdown += htmlToMarkdown(child);
        });
        break;
    }
    
    return markdown;
  }

  // Smart content extraction function
  function extractPageContent() {
    try {
      // Check cache first (valid for 5 minutes)
      const currentUrl = window.location.href;
      const cacheExpiry = 5 * 60 * 1000; // 5 minutes
      
      if (pageContentCache.url === currentUrl && 
          pageContentCache.content &&
          pageContentCache.timestamp &&
          (Date.now() - pageContentCache.timestamp) < cacheExpiry) {
        return pageContentCache.content;
      }

      // Performance check - don't extract from very large pages
      const bodyText = document.body?.textContent || '';
      if (bodyText.length > 100000) {
        console.log('LlamB: Page too large, using truncated content');
        const truncatedContent = bodyText.substring(0, 20000) + '\n\n[Content truncated - page too large]';
        
        // Cache the result
        pageContentCache = {
          url: currentUrl,
          content: truncatedContent,
          timestamp: Date.now()
        };
        
        return truncatedContent;
      }
      // Try to find main content areas in order of preference
      const contentSelectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '.main-content',
        '.post-content',
        '.entry-content',
        '.article-content',
        '#content',
        '#main',
        '.container .content',
        'body'
      ];

      let mainContent = null;

      // Find the first matching content area
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim().length > 100) {
          mainContent = element;
          break;
        }
      }

      if (!mainContent) {
        mainContent = document.body;
      }

      // Clone the element to avoid modifying the original
      const contentClone = mainContent.cloneNode(true);

      // Remove unwanted elements
      const unwantedSelectors = [
        'nav', 'header', 'footer', 'aside',
        '.navigation', '.nav', '.menu',
        '.header', '.footer', '.sidebar',
        '.ads', '.advertisement', '.banner',
        '.social', '.share', '.sharing',
        '.comments', '.comment-form',
        '.related-posts', '.recommended',
        '.popup', '.modal', '.overlay',
        'script', 'style', 'noscript',
        '[aria-hidden="true"]',
        '.hidden', '.visually-hidden',
        '#llamb-chat-sidebar' // Remove our own sidebar
      ];

      unwantedSelectors.forEach(selector => {
        const elements = contentClone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });

      // Convert to markdown
      let markdown = htmlToMarkdown(contentClone);

      // Clean up the markdown
      markdown = markdown
        // Remove excessive newlines
        .replace(/\n{3,}/g, '\n\n')
        // Remove leading/trailing whitespace
        .trim()
        // Remove empty lines at the start
        .replace(/^\n+/, '')
        // Remove excessive spaces
        .replace(/ {2,}/g, ' ');

      // Limit content size (approximately 5000 words)
      const maxWords = 5000;
      const words = markdown.split(/\s+/);
      if (words.length > maxWords) {
        markdown = words.slice(0, maxWords).join(' ') + '\n\n[Content truncated due to length]';
      }

      // Cache the result
      pageContentCache = {
        url: currentUrl,
        content: markdown,
        timestamp: Date.now()
      };

      return markdown;
    } catch (error) {
      console.error('LlamB: Error extracting page content:', error);
      // Fallback to simple text extraction
      return document.body?.textContent?.trim().substring(0, 10000) || '';
    }
  }

  // Simple markdown renderer
  function renderMarkdown(text) {
    if (!text) return '';
    
    let html = text
      // Code blocks (triple backticks)
      .replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'text';
        return `<pre class="llamb-code-block" data-lang="${language}"><code>${escapeHtml(code.trim())}</code></pre>`;
      })
      // Inline code (single backticks)  
      .replace(/`([^`]+)`/g, '<code class="llamb-inline-code">$1</code>')
      // Bold text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      // Italic text
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // Headers
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      // Lists
      .replace(/^\* (.*$)/gm, '<li>$1</li>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap in paragraphs and handle lists
    html = '<p>' + html + '</p>';
    
    // Fix list handling
    html = html.replace(/<p>(<li>.*?<\/li>)<\/p>/g, '<ul>$1</ul>');
    html = html.replace(/<\/li><br><li>/g, '</li><li>');
    html = html.replace(/<ul><li>/g, '<ul><li>');
    html = html.replace(/<\/li><\/ul>/g, '</li></ul>');
    
    // Clean up empty paragraphs and extra breaks
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><br><\/p>/g, '');
    html = html.replace(/(<\/h[1-6]>)<br>/g, '$1');
    html = html.replace(/(<\/pre>)<br>/g, '$1');
    
    return html;
  }

  // Update context chips display
  function updateContextChips() {
    const chipsContainer = document.getElementById('llamb-context-chips');
    if (!chipsContainer) return;
    
    // Update page chip
    const pageChip = chipsContainer.querySelector('.llamb-chip-page .llamb-chip-text');
    if (pageChip) {
      pageChip.textContent = document.title || 'Current page';
    }
    
    // Remove existing selection chips
    const existingSelectionChips = chipsContainer.querySelectorAll('.llamb-chip-selection');
    existingSelectionChips.forEach(chip => chip.remove());
    
    // Add chips for all preserved selections
    preservedSelections.forEach(selection => {
      const selectionChip = createSelectionChip(selection);
      chipsContainer.appendChild(selectionChip);
    });
    
    // Show/hide clear all button
    const clearAllBtn = document.getElementById('llamb-clear-all');
    if (clearAllBtn) {
      clearAllBtn.style.display = preservedSelections.length > 1 ? 'block' : 'none';
    }
  }

  // Create selection chip element
  function createSelectionChip(selection) {
    const chip = document.createElement('div');
    chip.className = 'llamb-chip llamb-chip-selection';
    chip.dataset.selectionId = selection.id;
    chip.innerHTML = `
      <span class="llamb-chip-icon">✂️</span>
      <span class="llamb-chip-text">${truncateText(selection.text, 30)}</span>
      <button class="llamb-chip-close" aria-label="Clear selection">×</button>
    `;
    
    // Add click handler to remove specific selection
    chip.querySelector('.llamb-chip-close').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeSelection(selection.id);
    });
    
    return chip;
  }

  // Create sidebar container
  function createSidebar() {
    const sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'llamb-chat-sidebar';
    sidebarContainer.className = 'llamb-sidebar-hidden';
    
    // Load sidebar content
    sidebarContainer.innerHTML = `
      <div class="llamb-sidebar-header">
        <div class="llamb-sidebar-title">
          <img src="${chrome.runtime.getURL('icons/icon128.png')}" alt="LlamB" class="llamb-logo">
          <span>LlamB Assistant</span>
        </div>
        <div class="llamb-header-actions">
          <button class="llamb-theme-toggle" id="llamb-theme-btn" title="Toggle theme">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-theme-icon llamb-theme-light-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-theme-icon llamb-theme-dark-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
            </svg>
          </button>
          <button class="llamb-sidebar-close" id="llamb-close-btn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-close-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="llamb-sidebar-content">
        <div class="llamb-chat-messages" id="llamb-messages">
          <div class="llamb-message-container llamb-assistant-container">
            <div class="llamb-message-avatar">
              <div class="llamb-avatar llamb-assistant-avatar">AI</div>
            </div>
            <div class="llamb-message-bubble llamb-assistant-bubble">
              <div class="llamb-message-content">
                Hello! I'm your AI assistant. I can see the current webpage and help you analyze it. How can I assist you today?
              </div>
            </div>
          </div>
        </div>
        <div class="llamb-chat-input-container">
          <div class="llamb-context-chips" id="llamb-context-chips">
            <div class="llamb-chip llamb-chip-page">
              <span class="llamb-chip-icon">📄</span>
              <span class="llamb-chip-text" id="page-title">${document.title || 'Current page'}</span>
            </div>
            <button class="llamb-clear-all-btn" id="llamb-clear-all" style="display: none;">Clear All Selections</button>
          </div>
          <div class="llamb-input-wrapper">
            <textarea 
              id="llamb-chat-input" 
              placeholder="Ask about this page or anything else..."
              rows="1"
            ></textarea>
            <button id="llamb-send-btn" class="llamb-send-btn">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-send-icon">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div class="llamb-sidebar-toggle" id="llamb-toggle-btn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
    `;

    document.body.appendChild(sidebarContainer);
    return sidebarContainer;
  }

  // Toggle sidebar visibility
  function toggleSidebar() {
    console.log('LlamB: toggleSidebar called, current isVisible:', isVisible);
    
    // Capture selection before showing sidebar
    if (!isVisible) {
      captureSelection();
    }
    
    if (!sidebar) {
      console.log('LlamB: Creating sidebar...');
      sidebar = createSidebar();
      setupEventListeners();
      // Apply theme after sidebar and buttons are created
      detectAndApplyTheme();
    }

    isVisible = !isVisible;
    console.log('LlamB: Setting isVisible to:', isVisible);
    
    // Update sidebar classes
    sidebar.className = isVisible ? 'llamb-sidebar-visible' : 'llamb-sidebar-hidden';
    console.log('LlamB: Set sidebar className to:', sidebar.className);
    
    // Update body classes to push content
    if (isVisible) {
      document.body.classList.remove('llamb-sidebar-closed');
      document.body.classList.add('llamb-sidebar-open');
      console.log('LlamB: Added llamb-sidebar-open to body');
      
      // Update context chips when showing sidebar
      setTimeout(() => updateContextChips(), 100);
    } else {
      document.body.classList.remove('llamb-sidebar-open');
      document.body.classList.add('llamb-sidebar-closed');
      console.log('LlamB: Added llamb-sidebar-closed to body');
      
      // Clear all selections when sidebar closes
      clearAllSelections();
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    const toggleBtn = document.getElementById('llamb-toggle-btn');
    const closeBtn = document.getElementById('llamb-close-btn');
    const themeBtn = document.getElementById('llamb-theme-btn');
    const sendBtn = document.getElementById('llamb-send-btn');
    const chatInput = document.getElementById('llamb-chat-input');

    console.log('LlamB: Setting up event listeners...');
    console.log('LlamB: toggleBtn found:', !!toggleBtn);
    console.log('LlamB: closeBtn found:', !!closeBtn);
    console.log('LlamB: themeBtn found:', !!themeBtn);
    
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        console.log('LlamB: Toggle button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        console.log('LlamB: Close button clicked!');
        e.preventDefault();
        e.stopPropagation();
        isVisible = false;
        sidebar.classList.remove('llamb-sidebar-visible');
        sidebar.classList.add('llamb-sidebar-hidden');
        
        // Update body classes to restore normal layout
        document.body.classList.remove('llamb-sidebar-open');
        document.body.classList.add('llamb-sidebar-closed');
      });
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', (e) => {
        console.log('LlamB: Theme button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      });
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });

    // Clear all selections button
    const clearAllBtn = document.getElementById('llamb-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearAllSelections();
      });
    }
  }

  // Send message function
  async function sendMessage() {
    console.log('LlamB: sendMessage called');
    const chatInput = document.getElementById('llamb-chat-input');
    const messagesContainer = document.getElementById('llamb-messages');
    const message = chatInput.value.trim();

    console.log('LlamB: Message content:', message);
    if (!message) {
      console.log('LlamB: Empty message, returning');
      return;
    }

    // Disable input while processing
    chatInput.disabled = true;
    const sendBtn = document.getElementById('llamb-send-btn');
    sendBtn.disabled = true;

    // Add user message
    const userMessageDiv = document.createElement('div');
    userMessageDiv.className = 'llamb-message-container llamb-user-container';
    userMessageDiv.innerHTML = `
      <div class="llamb-message-avatar">
        <div class="llamb-avatar llamb-user-avatar">You</div>
      </div>
      <div class="llamb-message-bubble llamb-user-bubble">
        <div class="llamb-message-content">${renderMarkdown(message)}</div>
      </div>
    `;
    messagesContainer.appendChild(userMessageDiv);

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      console.log('LlamB: Sending message:', message);
      
      // Get page context
      const pageContext = getPageContext();
      console.log('LlamB: Page context:', pageContext);
      
      // Send to background script for LLM processing
      console.log('LlamB: Sending to background...');
      const response = await chrome.runtime.sendMessage({
        action: 'sendChatMessage',
        message: message,
        pageContext: pageContext,
        options: {
          streaming: true,
          includeContext: true
        }
      });

      console.log('LlamB: Response from background:', response);

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to send message');
      }

      console.log('LlamB: Message sent, requestId:', response.requestId);

      // Create assistant message placeholder for streaming
      const assistantMessageDiv = document.createElement('div');
      assistantMessageDiv.className = 'llamb-message-container llamb-assistant-container';
      assistantMessageDiv.dataset.requestId = response.requestId;
      assistantMessageDiv.innerHTML = `
        <div class="llamb-message-avatar">
          <div class="llamb-avatar llamb-assistant-avatar">AI</div>
        </div>
        <div class="llamb-message-bubble llamb-assistant-bubble">
          <div class="llamb-message-content llamb-message-streaming"></div>
        </div>
      `;
      messagesContainer.appendChild(assistantMessageDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

    } catch (error) {
      console.error('LlamB: Error sending message:', error);
      
      // Show error message
      const contentDiv = assistantMessageDiv.querySelector('.llamb-message-content');
      contentDiv.innerHTML = `
        <div class="llamb-error-message">
          ❌ Error: ${escapeHtml(error.message)}
          <br><br>
          <small>Make sure you have configured an LLM connection in settings.</small>
        </div>
      `;
      
      // Re-enable input
      chatInput.disabled = false;
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  // Handle streaming chunk updates
  function handleStreamChunk(data) {
    const assistantMessage = document.querySelector(`[data-request-id="${data.requestId}"]`);
    if (!assistantMessage) return;

    const contentDiv = assistantMessage.querySelector('.llamb-message-content');
    
    // Remove streaming indicator on first chunk
    if (contentDiv.classList.contains('llamb-message-streaming')) {
      contentDiv.classList.remove('llamb-message-streaming');
      contentDiv.innerHTML = '';
    }

    // Render markdown for the full accumulated content
    contentDiv.innerHTML = renderMarkdown(data.fullContent || '');

    // Handle thinking/reasoning blocks
    if (data.blocks && data.blocks.length > 0) {
      const blocksContainer = contentDiv.querySelector('.llamb-blocks-container') || document.createElement('div');
      if (!blocksContainer.parentNode) {
        blocksContainer.className = 'llamb-blocks-container';
        contentDiv.insertBefore(blocksContainer, textContent);
      }

      blocksContainer.innerHTML = '';
      data.blocks.forEach(block => {
        const blockDiv = document.createElement('div');
        blockDiv.className = `llamb-block llamb-${block.type}-block`;
        
        const emoji = {
          'thinking': '🤔',
          'reasoning': '🧠',
          'reflection': '💭'
        }[block.type] || '💡';

        blockDiv.innerHTML = `
          <div class="llamb-block-header">
            <span class="llamb-block-emoji">${emoji}</span>
            <strong>${block.type.charAt(0).toUpperCase() + block.type.slice(1)}</strong>
          </div>
          <div class="llamb-block-content">${escapeHtml(block.content).replace(/\n/g, '<br>')}</div>
        `;
        
        blocksContainer.appendChild(blockDiv);
      });
    }

    // Auto-scroll to bottom
    const messagesContainer = document.getElementById('llamb-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Handle stream end
  function handleStreamEnd(data) {
    const assistantMessage = document.querySelector(`[data-request-id="${data.requestId}"]`);
    if (!assistantMessage) return;

    console.log('LlamB: Stream ended for request:', data.requestId);
    
    // Re-enable input
    const chatInput = document.getElementById('llamb-chat-input');
    const sendBtn = document.getElementById('llamb-send-btn');
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();

    // Remove streaming indicator if still present
    const contentDiv = assistantMessage.querySelector('.llamb-message-content');
    contentDiv.classList.remove('llamb-message-streaming');

    // Final scroll to bottom
    const messagesContainer = document.getElementById('llamb-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Handle stream errors
  function handleStreamError(data) {
    const assistantMessage = document.querySelector(`[data-request-id="${data.requestId}"]`);
    if (!assistantMessage) return;

    console.error('LlamB: Stream error:', data.error);
    
    const contentDiv = assistantMessage.querySelector('.llamb-message-content');
    contentDiv.innerHTML = `
      <div class="llamb-error-message">
        ❌ Streaming Error: ${escapeHtml(data.error)}
      </div>
    `;

    // Re-enable input
    const chatInput = document.getElementById('llamb-chat-input');
    const sendBtn = document.getElementById('llamb-send-btn');
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Get selected text from page
  function getSelectedText() {
    return window.getSelection().toString();
  }

  // Get page context
  function getPageContext() {
    // Combine all preserved selections
    const allSelections = preservedSelections.map(sel => sel.text).join('\n\n---\n\n');
    
    return {
      url: window.location.href,
      title: document.title,
      selectedText: allSelections || getSelectedText(),
      markdownContent: extractPageContent(),
      timestamp: new Date().toISOString()
    };
  }

  // Handle page layout changes for fixed/absolute positioned elements
  function handlePageLayoutChange() {
    // Some websites have fixed headers/footers that need adjustment
    const fixedElements = document.querySelectorAll('[style*="position: fixed"], [style*="position: sticky"]');
    const sidebarWidth = isVisible ? 380 : 0;
    
    fixedElements.forEach(element => {
      const computedStyle = window.getComputedStyle(element);
      const right = computedStyle.right;
      
      // Only adjust elements that are positioned from the right
      if (right && right !== 'auto' && !element.dataset.llambOriginalRight) {
        element.dataset.llambOriginalRight = right;
      }
      
      if (isVisible && element.dataset.llambOriginalRight) {
        const originalRight = parseInt(element.dataset.llambOriginalRight) || 0;
        element.style.right = (originalRight + sidebarWidth) + 'px';
      } else if (!isVisible && element.dataset.llambOriginalRight) {
        element.style.right = element.dataset.llambOriginalRight;
      }
    });
  }

  // Add selection change listener for real-time updates
  let selectionChangeTimeout;
  document.addEventListener('selectionchange', () => {
    // Debounce selection changes to avoid excessive updates
    clearTimeout(selectionChangeTimeout);
    selectionChangeTimeout = setTimeout(() => {
      if (isVisible) {
        const selection = window.getSelection().toString().trim();
        if (selection) {
          // Capture new selection if it's different from existing ones
          captureSelection();
          updateContextChips();
        }
      }
    }, 500);
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      console.log('LlamB: Received message:', request);
      
      if (request.action === 'toggleSidebar') {
        toggleSidebar();
        setTimeout(() => handlePageLayoutChange(), 100);
        sendResponse({ success: true });
      } else if (request.action === 'getPageContext') {
        const context = getPageContext();
        console.log('LlamB: Sending context:', context);
        sendResponse(context);
      } else if (request.action === 'addMessage') {
        // Handle messages from popup
        if (sidebar && isVisible) {
          const chatInput = document.getElementById('llamb-chat-input');
          if (chatInput) {
            chatInput.value = request.message;
            sendMessage();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Chat input not found' });
          }
        } else {
          sendResponse({ success: false, error: 'Sidebar not visible' });
        }
      } else if (request.action === 'streamChunk') {
        // Handle streaming response chunks
        handleStreamChunk(request);
        sendResponse({ success: true });
      } else if (request.action === 'streamEnd') {
        // Handle streaming response end
        handleStreamEnd(request);
        sendResponse({ success: true });
      } else if (request.action === 'streamError') {
        // Handle streaming errors
        handleStreamError(request);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('LlamB: Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true; // Keep the message channel open for async response
  });

  // Initialize body with default class
  document.body.classList.add('llamb-sidebar-closed');

  // Clear content cache when URL changes
  let lastUrl = window.location.href;
  new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      pageContentCache = {
        url: null,
        content: null,
        timestamp: null
      };
    }
  }).observe(document, { subtree: true, childList: true });

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    // Create toggle button immediately
    if (!sidebar) {
      sidebar = createSidebar();
      setupEventListeners();
      detectAndApplyTheme();
    }
  });

  // If DOM is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!sidebar) {
        sidebar = createSidebar();
        setupEventListeners();
      }
    });
  } else {
    if (!sidebar) {
      sidebar = createSidebar();
      setupEventListeners();
      detectAndApplyTheme();
    }
  }

  // Handle window resize to adjust layout
  window.addEventListener('resize', () => {
    if (isVisible) {
      handlePageLayoutChange();
    }
  });

  // Clean up when page unloads
  window.addEventListener('beforeunload', () => {
    document.body.classList.remove('llamb-sidebar-open', 'llamb-sidebar-closed');
  });

})();