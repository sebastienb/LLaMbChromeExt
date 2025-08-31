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
  
  // Chat management
  let chatManager = null;
  let storageManager = null;
  let currentChat = null;
  let tabId = null;

  // Cache for page content to avoid re-extraction
  let pageContentCache = {
    url: null,
    content: null,
    timestamp: null
  };

  // Load required scripts
  async function loadRequiredScripts() {
    try {
      // Load StorageManager - but check if it's already available and working
      if (typeof StorageManager === 'undefined' || !StorageManager.prototype.getSidebarState) {
        const storageScript = document.createElement('script');
        storageScript.src = chrome.runtime.getURL('js/storage-manager.js');
        document.head.appendChild(storageScript);
        await new Promise((resolve, reject) => {
          storageScript.onload = resolve;
          storageScript.onerror = reject;
        });
      }
      
      // Load ChatManager
      if (typeof ChatManager === 'undefined') {
        console.log('LlamB: Loading ChatManager script...');
        const chatScript = document.createElement('script');
        chatScript.src = chrome.runtime.getURL('js/chat-manager.js');
        document.head.appendChild(chatScript);
        await new Promise((resolve, reject) => {
          chatScript.onload = () => {
            console.log('LlamB: ChatManager script loaded, checking availability...');
            console.log('LlamB: ChatManager type after load:', typeof ChatManager);
            resolve();
          };
          chatScript.onerror = (error) => {
            console.error('LlamB: Failed to load ChatManager script:', error);
            reject(error);
          };
        });
      }
      
      console.log('LlamB: Required scripts loaded');
      console.log('LlamB: StorageManager available:', typeof StorageManager);
      console.log('LlamB: ChatManager available:', typeof ChatManager);
    } catch (error) {
      console.error('LlamB: Error loading scripts:', error);
    }
  }

  // Initialize chat and storage managers
  async function initializeManagers() {
    try {
      await loadRequiredScripts();
      
      // Get current tab ID
      console.log('LlamB: Requesting current tab from background...');
      const response = await chrome.runtime.sendMessage({ action: 'getCurrentTab' });
      console.log('LlamB: getCurrentTab response:', response);
      
      if (response && response.success && response.tab) {
        tabId = response.tab.id;
        console.log('LlamB: Got tabId from background:', tabId);
      } else {
        // Fallback: try to get tab info directly if possible
        console.log('LlamB: Background getCurrentTab failed, trying fallback...');
        tabId = Math.floor(Math.random() * 1000000); // Generate a session ID as fallback
        console.log('LlamB: Using fallback tabId:', tabId);
      }
      
      // Initialize managers with error handling
      if (typeof ChatManager !== 'undefined') {
        try {
          chatManager = new ChatManager();
          console.log('LlamB: ChatManager initialized successfully');
        } catch (error) {
          console.error('LlamB: Error creating ChatManager:', error);
          chatManager = null;
        }
      } else {
        console.warn('LlamB: ChatManager class not available');
      }
      
      if (typeof StorageManager !== 'undefined') {
        try {
          // Check if StorageManager has our custom methods
          if (StorageManager.prototype.getSidebarState) {
            storageManager = new StorageManager();
            console.log('LlamB: StorageManager initialized successfully');
          } else {
            console.warn('LlamB: StorageManager exists but missing custom methods, skipping');
            storageManager = null;
          }
        } catch (error) {
          console.error('LlamB: Error creating StorageManager:', error);
          console.log('LlamB: Trying to use basic functionality without custom StorageManager');
          storageManager = null;
        }
      } else {
        console.warn('LlamB: StorageManager class not available');
      }
      
      console.log('LlamB: Managers initialized, tabId:', tabId);
      console.log('LlamB: ChatManager ready:', !!chatManager);
      console.log('LlamB: StorageManager ready:', !!storageManager);
    } catch (error) {
      console.error('LlamB: Error initializing managers:', error);
    }
  }

  // Restore sidebar state from storage
  async function restoreSidebarState() {
    if (!tabId) {
      console.log('LlamB: No tabId available for state restoration');
      return;
    }
    
    if (!storageManager) {
      console.log('LlamB: No storageManager available, skipping state restoration');
      return;
    }
    
    try {
      const sidebarState = await storageManager.getSidebarState(tabId);
      console.log('LlamB: Restored sidebar state:', sidebarState);
      
      if (sidebarState.isVisible) {
        // Create sidebar if it doesn't exist
        if (!sidebar) {
          sidebar = createSidebar();
          setupEventListeners();
          detectAndApplyTheme();
        }
        
        // Restore visibility
        isVisible = true;
        sidebar.className = 'llamb-sidebar-visible';
        document.body.classList.remove('llamb-sidebar-closed');
        document.body.classList.add('llamb-sidebar-open');
        
        // Restore chat if specified
        if (sidebarState.chatId && chatManager) {
          await loadChat(sidebarState.chatId);
        }
      }
    } catch (error) {
      console.error('LlamB: Error restoring sidebar state:', error);
    }
  }

  // Save current sidebar state
  async function saveSidebarState() {
    if (!tabId) {
      console.log('LlamB: No tabId available for state saving');
      return;
    }
    
    if (!storageManager) {
      console.log('LlamB: No storageManager available, skipping state save');
      return;
    }
    
    try {
      const chatId = currentChat ? currentChat.id : null;
      await storageManager.setSidebarState(tabId, isVisible, chatId);
    } catch (error) {
      console.error('LlamB: Error saving sidebar state:', error);
    }
  }

  // Load chat into sidebar
  async function loadChat(chatId) {
    if (!chatManager || !chatId) return;
    
    try {
      const chat = await chatManager.loadChat(chatId);
      if (!chat) {
        console.warn('LlamB: Chat not found:', chatId);
        return;
      }
      
      currentChat = chat;
      chatManager.setActiveChat(chat);
      
      // Clear current messages and load chat history
      const messagesContainer = document.getElementById('llamb-messages');
      if (messagesContainer) {
        messagesContainer.innerHTML = '';
        
        // Add all messages from chat history
        chat.messages.forEach(message => {
          addMessageToUI(message.role, message.content, message.sourceUrl);
        });
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
      
      // Hide suggested actions if there are messages
      const suggestedActions = document.getElementById('llamb-suggested-actions');
      if (suggestedActions && chat.messages.length > 0) {
        suggestedActions.classList.add('hidden');
      }
      
      console.log('LlamB: Loaded chat:', chatId);
    } catch (error) {
      console.error('LlamB: Error loading chat:', error);
    }
  }

  // Create new chat
  async function createNewChat(initialMessage = null, pageContext = null) {
    if (!chatManager) return null;
    
    try {
      const chat = await chatManager.createChat(initialMessage, pageContext);
      currentChat = chat;
      chatManager.setActiveChat(chat);
      
      console.log('LlamB: Created new chat:', chat.id);
      return chat;
    } catch (error) {
      console.error('LlamB: Error creating new chat:', error);
      return null;
    }
  }

  // Add message to UI
  function addMessageToUI(role, content, sourceUrl = null) {
    const messagesContainer = document.getElementById('llamb-messages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `llamb-message-container llamb-${role}-container`;
    
    const avatar = role === 'user' ? 'You' : 'AI';
    const bubbleClass = role === 'user' ? 'llamb-user-bubble' : 'llamb-assistant-bubble';
    
    messageDiv.innerHTML = `
      <div class="llamb-message-avatar">
        <div class="llamb-avatar llamb-${role}-avatar">${avatar}</div>
      </div>
      <div class="llamb-message-bubble ${bubbleClass}">
        <div class="llamb-message-content">${role === 'user' ? renderMarkdown(content) : content}</div>
        ${sourceUrl ? `<div class="llamb-message-source"><small>Source: ${sourceUrl}</small></div>` : ''}
      </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // History dropdown management
  let cachedChatHistory = [];

  async function toggleHistoryDropdown() {
    const dropdown = document.getElementById('llamb-history-dropdown');
    if (!dropdown) return;
    
    const isVisible = dropdown.style.display !== 'none';
    
    if (isVisible) {
      hideHistoryDropdown();
    } else {
      await showHistoryDropdown();
    }
  }

  async function showHistoryDropdown() {
    const dropdown = document.getElementById('llamb-history-dropdown');
    if (!dropdown) return;
    
    dropdown.style.display = 'block';
    
    // Load chat history
    await loadChatHistory();
  }

  function hideHistoryDropdown() {
    const dropdown = document.getElementById('llamb-history-dropdown');
    if (!dropdown) return;
    
    dropdown.style.display = 'none';
    
    // Clear search
    const searchInput = document.getElementById('llamb-history-search');
    if (searchInput) {
      searchInput.value = '';
    }
  }

  async function loadChatHistory() {
    const historyList = document.getElementById('llamb-history-list');
    if (!historyList) return;
    
    try {
      historyList.innerHTML = '<div class="llamb-loading">Loading chat history...</div>';
      
      console.log('LlamB: Requesting chat history from background...');
      const response = await chrome.runtime.sendMessage({ action: 'getChatHistory' });
      console.log('LlamB: Chat history response:', response);
      
      if (!response) {
        throw new Error('No response from background script');
      }
      
      if (!response.success) {
        // Try direct storage access as fallback
        console.log('LlamB: Background failed, trying direct storage access...');
        try {
          const result = await chrome.storage.local.get('llamb-chats');
          const chats = result['llamb-chats'] || [];
          cachedChatHistory = chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          console.log('LlamB: Loaded', cachedChatHistory.length, 'chats from direct storage');
          renderChatHistory(cachedChatHistory);
          return;
        } catch (directError) {
          throw new Error(`Background: ${response.error || 'Unknown error'}, Direct: ${directError.message}`);
        }
      }
      
      cachedChatHistory = response.chatHistory || [];
      console.log('LlamB: Loaded', cachedChatHistory.length, 'chats from background');
      renderChatHistory(cachedChatHistory);
      
    } catch (error) {
      console.error('LlamB: Error loading chat history:', error);
      historyList.innerHTML = `<div class="llamb-error">Failed to load chat history<br><small>${error.message}</small></div>`;
    }
  }

  function renderChatHistory(chats) {
    const historyList = document.getElementById('llamb-history-list');
    if (!historyList) return;
    
    if (chats.length === 0) {
      historyList.innerHTML = '<div class="llamb-empty">No chat history found</div>';
      return;
    }
    
    // Group chats by domain
    const currentDomain = new URL(window.location.href).hostname;
    const currentDomainChats = chats.filter(chat => 
      chat.urls.some(url => {
        try {
          return new URL(url).hostname === currentDomain;
        } catch {
          return false;
        }
      })
    );
    
    const otherChats = chats.filter(chat => !currentDomainChats.includes(chat));
    
    historyList.innerHTML = '';
    
    // Add current domain chats first
    if (currentDomainChats.length > 0) {
      const domainHeader = document.createElement('div');
      domainHeader.className = 'llamb-history-group-header';
      domainHeader.textContent = `From ${currentDomain}`;
      historyList.appendChild(domainHeader);
      
      currentDomainChats.slice(0, 5).forEach(chat => {
        historyList.appendChild(createChatHistoryItem(chat));
      });
    }
    
    // Add other chats
    if (otherChats.length > 0) {
      const recentHeader = document.createElement('div');
      recentHeader.className = 'llamb-history-group-header';
      recentHeader.textContent = 'Recent Chats';
      historyList.appendChild(recentHeader);
      
      otherChats.slice(0, 10).forEach(chat => {
        historyList.appendChild(createChatHistoryItem(chat));
      });
    }
  }

  function createChatHistoryItem(chat) {
    const item = document.createElement('div');
    item.className = 'llamb-history-item';
    item.dataset.chatId = chat.id;
    
    const date = new Date(chat.updatedAt).toLocaleDateString();
    const time = new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sourceCount = chat.urls.length;
    
    item.innerHTML = `
      <div class="llamb-history-item-main">
        <div class="llamb-history-item-title">${escapeHtml(chat.title)}</div>
        <div class="llamb-history-item-meta">
          <span class="llamb-history-date">${date} ${time}</span>
          ${sourceCount > 0 ? `<span class="llamb-history-sources">${sourceCount} source${sourceCount > 1 ? 's' : ''}</span>` : ''}
          <span class="llamb-history-messages">${chat.messageCount} messages</span>
        </div>
      </div>
      <div class="llamb-history-item-actions">
        <button class="llamb-history-load" title="Load Chat">💬</button>
        <button class="llamb-history-delete" title="Delete Chat">🗑️</button>
      </div>
    `;
    
    // Add event listeners
    const loadBtn = item.querySelector('.llamb-history-load');
    const deleteBtn = item.querySelector('.llamb-history-delete');
    
    item.addEventListener('click', () => loadChatFromHistory(chat.id));
    loadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadChatFromHistory(chat.id);
    });
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChatFromHistory(chat.id);
    });
    
    return item;
  }

  async function loadChatFromHistory(chatId) {
    try {
      // Try using ChatManager first
      if (chatManager) {
        await loadChat(chatId);
      } else {
        // Fallback: request chat from background script
        console.log('LlamB: No ChatManager, requesting chat from background...');
        const response = await chrome.runtime.sendMessage({ action: 'loadChat', chatId: chatId });
        
        if (response && response.success && response.chat) {
          // Manually load the chat into UI
          currentChat = response.chat;
          
          // Clear current messages and load chat history
          const messagesContainer = document.getElementById('llamb-messages');
          if (messagesContainer) {
            messagesContainer.innerHTML = '';
            
            // Add all messages from chat history
            response.chat.messages.forEach(message => {
              addMessageToUI(message.role, message.content, message.sourceUrl);
            });
            
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
          
          // Hide suggested actions if there are messages
          const suggestedActions = document.getElementById('llamb-suggested-actions');
          if (suggestedActions && response.chat.messages.length > 0) {
            suggestedActions.classList.add('hidden');
          }
        } else {
          throw new Error(response?.error || 'Failed to load chat from background');
        }
      }
      
      hideHistoryDropdown();
      console.log('LlamB: Loaded chat from history:', chatId);
    } catch (error) {
      console.error('LlamB: Error loading chat from history:', error);
      alert('Failed to load chat: ' + error.message);
    }
  }

  async function deleteChatFromHistory(chatId) {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'deleteChat',
        chatId: chatId
      });
      
      if (response.success) {
        // Remove from UI
        const item = document.querySelector(`[data-chat-id="${chatId}"]`);
        if (item) {
          item.remove();
        }
        
        // Remove from cache
        cachedChatHistory = cachedChatHistory.filter(chat => chat.id !== chatId);
        
        // If this was the current chat, clear it
        if (currentChat && currentChat.id === chatId) {
          currentChat = null;
          if (chatManager) {
            chatManager.clearActiveChat();
          }
          clearChat();
        }
        
        console.log('LlamB: Deleted chat from history:', chatId);
      } else {
        throw new Error(response.error || 'Failed to delete chat');
      }
    } catch (error) {
      console.error('LlamB: Error deleting chat from history:', error);
      alert('Failed to delete chat: ' + error.message);
    }
  }

  function filterChatHistory(query) {
    if (!query.trim()) {
      renderChatHistory(cachedChatHistory);
      return;
    }
    
    const filteredChats = cachedChatHistory.filter(chat => 
      chat.title.toLowerCase().includes(query.toLowerCase()) ||
      chat.urls.some(url => url.toLowerCase().includes(query.toLowerCase()))
    );
    
    renderChatHistory(filteredChats);
  }

  async function startNewChat() {
    try {
      // Clear current chat
      currentChat = null;
      if (chatManager) {
        chatManager.clearActiveChat();
      }
      
      // Clear messages UI
      clearChat();
      
      // Save state
      saveSidebarState();
      
      console.log('LlamB: Started new chat');
    } catch (error) {
      console.error('LlamB: Error starting new chat:', error);
    }
  }

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

  // Update suggested action buttons based on context
  function updateSuggestedActions() {
    const explainButton = document.querySelector('[data-action="explain-selected"]');
    if (explainButton) {
      const hasSelection = preservedSelections.length > 0 || getSelectedText();
      if (hasSelection) {
        explainButton.textContent = '🔍 Explain selected text';
        explainButton.disabled = false;
        explainButton.style.opacity = '1';
      } else {
        explainButton.textContent = '🔍 Select text to explain';
        explainButton.disabled = true;
        explainButton.style.opacity = '0.6';
      }
    }
  }

  // Get site favicon
  function getSiteFavicon() {
    // Try to find favicon from various sources in order of preference
    const selectors = [
      'link[rel*="icon"][sizes*="32"]',  // 32x32 favicon
      'link[rel*="icon"][sizes*="16"]',  // 16x16 favicon  
      'link[rel="shortcut icon"]',       // Shortcut icon
      'link[rel="icon"]',                // Generic icon
      'link[rel="apple-touch-icon"]'     // Apple touch icon as fallback
    ];
    
    for (const selector of selectors) {
      const favicon = document.querySelector(selector);
      if (favicon && favicon.href) {
        return favicon.href;
      }
    }
    
    // Fallback to default favicon.ico
    try {
      const url = new URL('/favicon.ico', window.location.origin);
      return url.href;
    } catch {
      return null;
    }
  }

  // Update context chips display
  function updateContextChips() {
    const chipsContainer = document.getElementById('llamb-context-chips');
    if (!chipsContainer) return;
    
    // Update page chip
    const pageChip = chipsContainer.querySelector('.llamb-chip-page .llamb-chip-text');
    const pageChipIcon = chipsContainer.querySelector('.llamb-chip-page .llamb-chip-icon');
    if (pageChip) {
      pageChip.textContent = document.title || 'Current page';
    }
    if (pageChipIcon) {
      const favicon = getSiteFavicon();
      if (favicon) {
        // Replace emoji with favicon image
        pageChipIcon.innerHTML = `<img src="${favicon}" alt="Site icon" style="width: 16px; height: 16px;" onerror="this.style.display='none'; this.parentElement.innerHTML = '📄';">`;
      } else {
        // Fallback to page icon
        pageChipIcon.textContent = '📄';
      }
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
    
    // Update suggested actions when context changes
    updateSuggestedActions();
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
          <button class="llamb-history-btn" id="llamb-history-btn" title="Chat History">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-history-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </button>
          <button class="llamb-new-chat-btn" id="llamb-new-chat-btn" title="New Chat">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-new-chat-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
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
      <div class="llamb-history-dropdown" id="llamb-history-dropdown" style="display: none;">
        <div class="llamb-history-header">
          <span>Chat History</span>
          <button class="llamb-history-close" id="llamb-history-close">×</button>
        </div>
        <div class="llamb-history-search">
          <input type="text" id="llamb-history-search" placeholder="Search chats..." />
        </div>
        <div class="llamb-history-list" id="llamb-history-list">
          <div class="llamb-loading">Loading chat history...</div>
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
          <div class="llamb-suggested-actions" id="llamb-suggested-actions">
            <button class="llamb-action-btn" data-action="summarize">
              📝 Summarize this page
            </button>
            <button class="llamb-action-btn" data-action="explain-selected">
              🔍 Explain selected text
            </button>
            <button class="llamb-action-btn" data-action="what-about">
              ❓ What is this page about?
            </button>
            <button class="llamb-action-btn" data-action="key-takeaways">
              💡 Key takeaways
            </button>
          </div>
        </div>
        <div class="llamb-chat-input-container">
          <div class="llamb-context-chips" id="llamb-context-chips">
            <div class="llamb-chip llamb-chip-page">
              <span class="llamb-chip-icon">${(() => {
                const favicon = getSiteFavicon();
                return favicon ? `<img src="${favicon}" alt="Site icon" style="width: 16px; height: 16px;" onerror="this.style.display='none'; this.parentElement.innerHTML = '📄';">` : '📄';
              })()}</span>
              <span class="llamb-chip-text" id="page-title">${document.title || 'Current page'}</span>
            </div>
            <button class="llamb-clear-all-btn" id="llamb-clear-all" style="display: none;">Clear All Selections</button>
          </div>
          <div class="llamb-input-wrapper">
            <textarea 
              id="llamb-chat-input" 
              placeholder="Ask me anything..."
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
    
    // Save sidebar state
    saveSidebarState();
  }

  // Setup event listeners
  function setupEventListeners() {
    const toggleBtn = document.getElementById('llamb-toggle-btn');
    const closeBtn = document.getElementById('llamb-close-btn');
    const themeBtn = document.getElementById('llamb-theme-btn');
    const historyBtn = document.getElementById('llamb-history-btn');
    const newChatBtn = document.getElementById('llamb-new-chat-btn');
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

    if (historyBtn) {
      historyBtn.addEventListener('click', (e) => {
        console.log('LlamB: History button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleHistoryDropdown();
      });
    }

    if (newChatBtn) {
      newChatBtn.addEventListener('click', (e) => {
        console.log('LlamB: New chat button clicked!');
        e.preventDefault();
        e.stopPropagation();
        startNewChat();
      });
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Set up suggested action buttons
    const actionButtons = document.querySelectorAll('.llamb-action-btn');
    actionButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const action = e.target.getAttribute('data-action');
        handleSuggestedAction(action);
      });
    });
    
    // Update suggested actions on initial load
    updateSuggestedActions();

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

    // History dropdown event listeners
    const historyClose = document.getElementById('llamb-history-close');
    if (historyClose) {
      historyClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideHistoryDropdown();
      });
    }

    const historySearch = document.getElementById('llamb-history-search');
    if (historySearch) {
      historySearch.addEventListener('input', (e) => {
        filterChatHistory(e.target.value);
      });
    }
  }

  // Handle suggested action clicks
  function handleSuggestedAction(action) {
    const chatInput = document.getElementById('llamb-chat-input');
    const suggestedActions = document.getElementById('llamb-suggested-actions');
    
    let message = '';
    
    switch (action) {
      case 'summarize':
        message = 'Please summarize the content of this webpage, highlighting the main points and key information.';
        break;
      case 'explain-selected':
        const selectedText = preservedSelections.length > 0 
          ? preservedSelections.map(sel => sel.text).join('\n\n---\n\n')
          : getSelectedText();
        
        if (!selectedText) {
          message = 'Please select some text on the page first, then I can explain it for you.';
        } else {
          message = 'Please explain the selected text in detail and provide context about its meaning.';
        }
        break;
      case 'what-about':
        message = 'What is this webpage about? Please provide an overview of the topic, purpose, and main content.';
        break;
      case 'key-takeaways':
        message = 'What are the key takeaways from this webpage? Please extract the most important insights, conclusions, or actionable information.';
        break;
    }
    
    // Set the message in the input field
    chatInput.value = message;
    
    // Hide suggested actions
    if (suggestedActions) {
      suggestedActions.classList.add('hidden');
    }
    
    // Send the message automatically
    sendMessage();
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

    // Get page context
    const pageContext = getPageContext();

    // Create new chat if none exists
    if (!currentChat) {
      if (chatManager) {
        currentChat = await createNewChat();
        saveSidebarState();
      } else {
        // Fallback: create simple chat object
        console.log('LlamB: No ChatManager, creating simple chat object...');
        currentChat = {
          id: 'chat-' + Date.now(),
          title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          messages: [],
          urls: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
    }

    // Add user message to chat
    if (currentChat) {
      if (chatManager) {
        await chatManager.addMessage(currentChat, 'user', message, pageContext);
      } else {
        // Fallback: add message directly to chat object
        currentChat.messages.push({
          role: 'user',
          content: message,
          timestamp: new Date().toISOString(),
          sourceUrl: pageContext.url
        });
        // Try to save directly to storage
        try {
          const result = await chrome.storage.local.get('llamb-chats');
          const chats = result['llamb-chats'] || [];
          const existingIndex = chats.findIndex(c => c.id === currentChat.id);
          if (existingIndex !== -1) {
            chats[existingIndex] = currentChat;
          } else {
            chats.push(currentChat);
          }
          await chrome.storage.local.set({ 'llamb-chats': chats });
          console.log('LlamB: Saved chat to storage (fallback)');
        } catch (error) {
          console.error('LlamB: Failed to save chat (fallback):', error);
        }
      }
    }

    // Add user message to UI
    addMessageToUI('user', message, pageContext.url);

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Hide suggested actions after first user message
    const suggestedActions = document.getElementById('llamb-suggested-actions');
    if (suggestedActions && !suggestedActions.classList.contains('hidden')) {
      suggestedActions.classList.add('hidden');
    }

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
        contentDiv.insertBefore(blocksContainer, contentDiv.firstChild);
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
  async function handleStreamEnd(data) {
    const assistantMessage = document.querySelector(`[data-request-id="${data.requestId}"]`);
    if (!assistantMessage) return;

    console.log('LlamB: Stream ended for request:', data.requestId);
    
    // Save assistant message to chat
    if (currentChat && data.fullContent) {
      try {
        if (chatManager) {
          await chatManager.addMessage(currentChat, 'assistant', data.fullContent);
          console.log('LlamB: Saved assistant message to chat');
        } else {
          // Fallback: add message directly
          currentChat.messages.push({
            role: 'assistant',
            content: data.fullContent,
            timestamp: new Date().toISOString()
          });
          currentChat.updatedAt = new Date().toISOString();
          
          // Save to storage
          const result = await chrome.storage.local.get('llamb-chats');
          const chats = result['llamb-chats'] || [];
          const existingIndex = chats.findIndex(c => c.id === currentChat.id);
          if (existingIndex !== -1) {
            chats[existingIndex] = currentChat;
          } else {
            chats.push(currentChat);
          }
          // Sort by updatedAt
          chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          await chrome.storage.local.set({ 'llamb-chats': chats });
          console.log('LlamB: Saved assistant message to chat (fallback)');
        }
      } catch (error) {
        console.error('LlamB: Error saving assistant message:', error);
      }
    }
    
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

  // Clear chat and show suggestions
  function clearChat() {
    const messagesContainer = document.getElementById('llamb-messages');
    const suggestedActions = document.getElementById('llamb-suggested-actions');
    
    if (messagesContainer) {
      // Keep only the initial AI message and suggested actions
      const assistantMessages = messagesContainer.querySelectorAll('.llamb-message-container.llamb-assistant-container');
      const initialMessage = assistantMessages[0]; // First assistant message
      
      messagesContainer.innerHTML = '';
      if (initialMessage) {
        messagesContainer.appendChild(initialMessage);
      }
    }
    
    // Show suggested actions again
    if (suggestedActions) {
      suggestedActions.classList.remove('hidden');
    }
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
  async function initialize() {
    await initializeManagers();
    await restoreSidebarState();
    
    // Create sidebar if not already created during restoration
    if (!sidebar) {
      sidebar = createSidebar();
      setupEventListeners();
      detectAndApplyTheme();
    }
  }

  document.addEventListener('DOMContentLoaded', initialize);

  // If DOM is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
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