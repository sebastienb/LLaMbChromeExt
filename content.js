// Content script - injected into every webpage
(function() {
  'use strict';

  // Create local debug logger that checks settings
  let debugEnabled = false;
  
  // Load debug setting from storage
  chrome.storage.local.get('llamb-settings', (result) => {
    const settings = result['llamb-settings'] || {};
    debugEnabled = settings.globalSettings?.debugLogging === true;
  });
  
  // Listen for setting changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['llamb-settings']) {
      const newSettings = changes['llamb-settings'].newValue;
      if (newSettings?.globalSettings?.debugLogging !== undefined) {
        debugEnabled = newSettings.globalSettings.debugLogging;
      }
    }
  });
  
  // Debug logging functions
  const debugLog = (...args) => {
    if (debugEnabled) debugLog('[LlamB]', ...args);
  };
  const debugError = (...args) => debugError('[LlamB]', ...args); // Always show errors
  const debugWarn = (...args) => {
    if (debugEnabled) debugWarn('[LlamB]', ...args);
  };

  // Prevent multiple injections
  if (window.llambChatInjected) {
    return;
  }
  window.llambChatInjected = true;

  let sidebar = null;
  let isVisible = false;
  let isFloatingMode = false;
  let floatingPosition = { x: 20, y: 20 };
  let floatingSize = { width: 400, height: 600 };
  let preservedSelections = []; // Array to store multiple selections
  let selectionCounter = 0;
  
  // Chat management
  let chatManager = null;
  let storageManager = null;
  let currentChat = null;
  let tabId = null;
  
  // Plugin management
  let pluginManager = null;

  // Cache for page content to avoid re-extraction
  let pageContentCache = {
    url: null,
    content: null,
    timestamp: null
  };

  // Load required scripts
  async function loadRequiredScripts() {
    const scriptsToLoad = [];
    
    try {
      // Load StorageManager - but check if it's already available and working
      if (typeof StorageManager === 'undefined' || !StorageManager.prototype.getSidebarState) {
        scriptsToLoad.push({
          name: 'StorageManager',
          src: 'js/storage-manager.js'
        });
      }
      
      // Load ChatManager
      if (typeof ChatManager === 'undefined') {
        scriptsToLoad.push({
          name: 'ChatManager',
          src: 'js/chat-manager.js'
        });
      }
      
      // Load scripts with proper error handling
      for (const scriptInfo of scriptsToLoad) {
        try {
          debugLog(`LlamB: Loading ${scriptInfo.name} script...`);
          const script = document.createElement('script');
          script.src = chrome.runtime.getURL(scriptInfo.src);
          
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`${scriptInfo.name} script load timeout`));
            }, 5000); // 5 second timeout
            
            script.onload = () => {
              clearTimeout(timeout);
              // Give the script time to execute
              setTimeout(() => {
                debugLog(`LlamB: ${scriptInfo.name} loaded successfully`);
                resolve();
              }, 100);
            };
            
            script.onerror = (error) => {
              clearTimeout(timeout);
              reject(new Error(`Failed to load ${scriptInfo.name}: ${error}`));
            };
            
            document.head.appendChild(script);
          });
        } catch (scriptError) {
          debugError(`LlamB: Error loading ${scriptInfo.name}:`, scriptError);
          // Continue loading other scripts even if one fails
        }
      }
      
      // Plugin classes should be loaded by manifest.json content_scripts
      debugLog('LlamB: Checking for plugin classes loaded by manifest...');
      debugLog('LlamB: LlambPluginBase available:', typeof LlambPluginBase);
      debugLog('LlamB: PluginManager available:', typeof PluginManager);
      debugLog('LlamB: YoutubeCaptionsPlugin available:', typeof YoutubeCaptionsPlugin);
      
      debugLog('LlamB: Required scripts loaded');
      debugLog('LlamB: StorageManager available:', typeof StorageManager);
      debugLog('LlamB: ChatManager available:', typeof ChatManager);
      debugLog('LlamB: PluginManager available:', typeof PluginManager);
      debugLog('LlamB: LlambPluginBase available:', typeof LlambPluginBase);
    } catch (error) {
      debugError('LlamB: Critical error loading scripts:', error);
      // Extension can still work with reduced functionality
    }
  }

  // Initialize chat and storage managers
  async function initializeManagers() {
    try {
      await loadRequiredScripts();
      
      // Get current tab ID
      debugLog('LlamB: Requesting current tab from background...');
      const response = await chrome.runtime.sendMessage({ action: 'getCurrentTab' });
      debugLog('LlamB: getCurrentTab response:', response);
      
      if (response && response.success && response.tab) {
        tabId = response.tab.id;
        debugLog('LlamB: Got tabId from background:', tabId);
      } else {
        // Fallback: try to get tab info directly if possible
        debugLog('LlamB: Background getCurrentTab failed, trying fallback...');
        tabId = Math.floor(Math.random() * 1000000); // Generate a session ID as fallback
        debugLog('LlamB: Using fallback tabId:', tabId);
      }
      
      // Initialize managers with error handling
      if (typeof window.ChatManager === 'function') {
        try {
          chatManager = new window.ChatManager();
          debugLog('LlamB: ChatManager initialized successfully');
        } catch (error) {
          debugError('LlamB: Error creating ChatManager:', error);
          chatManager = null;
        }
      } else {
        debugWarn('LlamB: ChatManager class not available');
        debugLog('LlamB: window.ChatManager type:', typeof window.ChatManager);
      }
      
      // Initialize PluginManager
      if (typeof PluginManager === 'function') {
        try {
          pluginManager = new PluginManager();
          await pluginManager.initialize();
          debugLog('LlamB: PluginManager initialized successfully');
          
          // Plugin enablement is now managed through settings
          debugLog('LlamB: PluginManager will load enabled plugins from storage');
          
          // Notify plugins of current page
          debugLog('LlamB: Notifying plugins of page change...');
          await pluginManager.onPageChange();
        } catch (error) {
          debugError('LlamB: Error creating PluginManager:', error);
          pluginManager = null;
        }
      } else {
        debugWarn('LlamB: PluginManager class not available');
        debugLog('LlamB: typeof PluginManager:', typeof PluginManager);
        debugLog('LlamB: typeof window.PluginManager:', typeof window.PluginManager);
      }
      
      if (typeof StorageManager !== 'undefined') {
        try {
          // Check if StorageManager has our custom methods
          if (StorageManager.prototype.getSidebarState) {
            storageManager = new StorageManager();
            debugLog('LlamB: StorageManager initialized successfully');
          } else {
            debugWarn('LlamB: StorageManager exists but missing custom methods, skipping');
            storageManager = null;
          }
        } catch (error) {
          debugError('LlamB: Error creating StorageManager:', error);
          debugLog('LlamB: Trying to use basic functionality without custom StorageManager');
          storageManager = null;
        }
      } else {
        debugWarn('LlamB: StorageManager class not available');
      }
      
      debugLog('LlamB: Managers initialized, tabId:', tabId);
      debugLog('LlamB: ChatManager ready:', !!chatManager);
      debugLog('LlamB: StorageManager ready:', !!storageManager);
    } catch (error) {
      debugError('LlamB: Error initializing managers:', error);
    }
  }

  // Restore sidebar state from storage
  async function restoreSidebarState() {
    if (!tabId) {
      debugLog('LlamB: No tabId available for state restoration');
      return;
    }
    
    if (!storageManager) {
      debugLog('LlamB: No storageManager available, skipping state restoration');
      return;
    }
    
    try {
      const sidebarState = await storageManager.getSidebarState(tabId);
      debugLog('LlamB: Restored sidebar state:', sidebarState);
      
      // Handle both old and new state formats
      const stateIsVisible = sidebarState.isVisible || sidebarState;
      const stateIsFloating = sidebarState.isFloatingMode || false;
      const statePosition = sidebarState.floatingPosition || { x: 20, y: 20 };
      const stateSize = sidebarState.floatingSize || { width: 400, height: 600 };
      const stateChatId = sidebarState.chatId || null;
      
      if (stateIsVisible) {
        // Restore floating mode settings
        isFloatingMode = stateIsFloating;
        floatingPosition = statePosition;
        floatingSize = stateSize;
        
        // Create sidebar if it doesn't exist
        if (!sidebar) {
          sidebar = createSidebar();
          setupEventListeners();
          detectAndApplyTheme();
        }
        
        // Restore visibility and mode
        isVisible = true;
        updateSidebarDisplay();
        
        // Restore chat if specified
        if (stateChatId && chatManager) {
          await loadChat(stateChatId);
        }
      }
    } catch (error) {
      debugError('LlamB: Error restoring sidebar state:', error);
    }
  }

  // Save current sidebar state
  async function saveSidebarState() {
    // Save to localStorage for mode preference (persistent across sessions)
    try {
      localStorage.setItem('llamb-mode-preference', isFloatingMode ? 'floating' : 'sidebar');
      localStorage.setItem('llamb-floating-position', JSON.stringify(floatingPosition));
      localStorage.setItem('llamb-floating-size', JSON.stringify(floatingSize));
      debugLog('LlamB: Saved mode preference:', isFloatingMode ? 'floating' : 'sidebar');
    } catch (e) {
      debugError('LlamB: Error saving to localStorage:', e);
    }
    
    if (!tabId) {
      debugLog('LlamB: No tabId available for state saving');
      return;
    }
    
    if (!storageManager) {
      debugLog('LlamB: No storageManager available, skipping state save');
      return;
    }
    
    try {
      const chatId = currentChat ? currentChat.id : null;
      const state = {
        isVisible,
        isFloatingMode,
        floatingPosition,
        floatingSize,
        chatId
      };
      await storageManager.setSidebarState(tabId, state);
    } catch (error) {
      debugError('LlamB: Error saving sidebar state:', error);
    }
  }

  // Load chat into sidebar
  async function loadChat(chatId) {
    if (!chatManager || !chatId) return;
    
    try {
      const chat = await chatManager.loadChat(chatId);
      if (!chat) {
        debugWarn('LlamB: Chat not found:', chatId);
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
      
      debugLog('LlamB: Loaded chat:', chatId);
    } catch (error) {
      debugError('LlamB: Error loading chat:', error);
    }
  }

  // Create new chat
  async function createNewChat(initialMessage = null, pageContext = null) {
    if (!chatManager) return null;
    
    try {
      const chat = await chatManager.createChat(initialMessage, pageContext);
      currentChat = chat;
      chatManager.setActiveChat(chat);
      
      debugLog('LlamB: Created new chat:', chat.id);
      return chat;
    } catch (error) {
      debugError('LlamB: Error creating new chat:', error);
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

  // Chip content modal management
  function showChipContentModal(chipType, chipData) {
    const modal = document.getElementById('llamb-chip-content-modal');
    const titleElement = document.getElementById('llamb-chip-modal-title');
    const contentElement = document.getElementById('llamb-chip-modal-content');
    
    if (!modal || !titleElement || !contentElement) return;

    // Hide history dropdown if open
    hideHistoryDropdown();
    
    // Set title based on chip type
    let title = 'Chip Content';
    switch (chipType) {
      case 'selection':
        title = 'Selected Text';
        break;
      case 'plugin':
        title = chipData.name || chipData.text || 'Plugin Content';
        break;
      case 'page':
        title = 'Page Information';
        break;
      default:
        title = chipData.title || 'Content Details';
    }
    
    titleElement.textContent = title;
    contentElement.innerHTML = '<div class="llamb-loading">Loading content...</div>';
    
    // Show modal
    modal.style.display = 'flex';
    
    // Load content asynchronously
    loadChipContent(chipType, chipData, contentElement);
  }

  function hideChipContentModal() {
    const modal = document.getElementById('llamb-chip-content-modal');
    if (!modal) return;
    
    modal.style.display = 'none';
  }

  async function loadChipContent(chipType, chipData, contentElement) {
    try {
      let content = '';
      let metadata = {};
      
      switch (chipType) {
        case 'selection':
          content = await getSelectionContent(chipData);
          metadata = {
            'Text Length': chipData.text.length + ' characters',
            'Word Count': chipData.text.split(/\s+/).length + ' words',
            'Captured': new Date(chipData.timestamp).toLocaleString()
          };
          break;
          
        case 'plugin':
          content = await getPluginContent(chipData);
          metadata = await getPluginMetadata(chipData);
          break;
          
        case 'page':
          content = await getPageContent();
          metadata = {
            'URL': window.location.href,
            'Title': document.title,
            'Domain': window.location.hostname,
            'Last Updated': new Date().toLocaleString()
          };
          break;
          
        default:
          content = 'No content available';
      }
      
      // Render content with metadata
      renderChipModalContent(contentElement, content, metadata, chipType);
      
    } catch (error) {
      debugError('LlamB: Error loading chip content:', error);
      contentElement.innerHTML = '<div class="llamb-error">Failed to load content: ' + error.message + '</div>';
    }
  }

  async function getSelectionContent(chipData) {
    return `## Selected Text\n\n${chipData.text}`;
  }

  async function getPluginContent(chipData) {
    if (!pluginManager) return 'Plugin manager not available';
    
    const plugin = pluginManager.plugins.get(chipData.pluginId);
    if (!plugin) return 'Plugin not found';
    
    // Try to get detailed content if available
    if (typeof plugin.getDetailedContent === 'function') {
      const detailedContent = await plugin.getDetailedContent();
      if (detailedContent) return detailedContent;
    }
    
    // Fall back to regular content
    if (typeof plugin.getContent === 'function') {
      const content = await plugin.getContent();
      if (content) return content;
    }
    
    return 'No content available from plugin';
  }

  async function getPluginMetadata(chipData) {
    if (!pluginManager) return {};
    
    const plugin = pluginManager.plugins.get(chipData.pluginId);
    if (!plugin) return {};
    
    const manifest = pluginManager.pluginRegistry.get(chipData.pluginId);
    return {
      'Plugin': manifest?.name || chipData.pluginId,
      'Version': manifest?.version || 'Unknown',
      'Status': chipData.status || 'Unknown',
      'Description': chipData.description || manifest?.description || ''
    };
  }

  async function getPageContent() {
    const pageContext = pluginManager?.getCurrentPageContext() || {
      url: window.location.href,
      title: document.title,
      domain: window.location.hostname,
      selectedText: window.getSelection()?.toString() || ''
    };
    
    let content = `## Page Information\n\n`;
    content += `**Title:** ${pageContext.title}\n\n`;
    content += `**URL:** ${pageContext.url}\n\n`;
    content += `**Domain:** ${pageContext.domain}\n\n`;
    
    if (pageContext.selectedText) {
      content += `**Current Selection:** ${pageContext.selectedText}\n\n`;
    }
    
    // Add meta description if available
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && metaDesc.content) {
      content += `**Description:** ${metaDesc.content}\n\n`;
    }
    
    return content;
  }

  function renderChipModalContent(contentElement, content, metadata, chipType) {
    let html = '';
    
    // Add metadata section if available
    if (Object.keys(metadata).length > 0) {
      html += '<div class="llamb-chip-content-metadata">';
      html += '<h4>Information</h4>';
      for (const [key, value] of Object.entries(metadata)) {
        if (value) {
          html += `<p><strong>${key}:</strong> ${value}</p>`;
        }
      }
      html += '</div>';
    }
    
    // Add main content
    if (content) {
      html += markdownToHtml(content);
    }
    
    // Add action buttons
    html += '<div class="llamb-chip-content-actions">';
    html += '<button class="llamb-chip-action-btn" onclick="copyChipContent()">Copy Content</button>';
    if (chipType === 'plugin') {
      html += '<button class="llamb-chip-action-btn" onclick="refreshPluginContent()">Refresh</button>';
    }
    html += '</div>';
    
    contentElement.innerHTML = html;
    
    // Store content for copy function
    contentElement.dataset.content = content;
    contentElement.dataset.chipType = chipType;
  }

  // Copy content to clipboard
  window.copyChipContent = function() {
    const contentElement = document.getElementById('llamb-chip-modal-content');
    const content = contentElement?.dataset.content;
    
    if (content) {
      navigator.clipboard.writeText(content).then(() => {
        // Show brief feedback
        const copyBtn = contentElement.querySelector('.llamb-chip-action-btn');
        if (copyBtn) {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 1500);
        }
      });
    }
  };

  // Refresh plugin content
  window.refreshPluginContent = function() {
    const contentElement = document.getElementById('llamb-chip-modal-content');
    const chipType = contentElement?.dataset.chipType;
    
    if (chipType === 'plugin') {
      contentElement.innerHTML = '<div class="llamb-loading">Refreshing content...</div>';
      // This would need to be implemented based on the specific plugin
      // For now, just reload the modal
      setTimeout(() => {
        // Would need to access the original chipData
        contentElement.innerHTML = '<div class="llamb-error">Refresh not implemented yet</div>';
      }, 1000);
    }
  };

  // Simple markdown to HTML converter for modal content
  function markdownToHtml(markdown) {
    return markdown
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.)/gm, '<p>$1')
      .replace(/$(.)/gm, '$1</p>')
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<h[1-6]>)/g, '$1')
      .replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  }

  async function loadChatHistory() {
    const historyList = document.getElementById('llamb-history-list');
    if (!historyList) return;
    
    try {
      historyList.innerHTML = '<div class="llamb-loading">Loading chat history...</div>';
      
      debugLog('LlamB: Requesting chat history from background...');
      const response = await chrome.runtime.sendMessage({ action: 'getChatHistory' });
      debugLog('LlamB: Chat history response:', response);
      
      if (!response) {
        throw new Error('No response from background script');
      }
      
      if (!response.success) {
        // Try direct storage access as fallback
        debugLog('LlamB: Background failed, trying direct storage access...');
        try {
          const result = await chrome.storage.local.get('llamb-chats');
          const chats = result['llamb-chats'] || [];
          cachedChatHistory = chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          debugLog('LlamB: Loaded', cachedChatHistory.length, 'chats from direct storage');
          renderChatHistory(cachedChatHistory);
          return;
        } catch (directError) {
          throw new Error(`Background: ${response.error || 'Unknown error'}, Direct: ${directError.message}`);
        }
      }
      
      cachedChatHistory = response.chatHistory || [];
      debugLog('LlamB: Loaded', cachedChatHistory.length, 'chats from background');
      renderChatHistory(cachedChatHistory);
      
    } catch (error) {
      debugError('LlamB: Error loading chat history:', error);
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
        debugLog('LlamB: No ChatManager, requesting chat from background...');
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
      debugLog('LlamB: Loaded chat from history:', chatId);
    } catch (error) {
      debugError('LlamB: Error loading chat from history:', error);
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
        
        debugLog('LlamB: Deleted chat from history:', chatId);
      } else {
        throw new Error(response.error || 'Failed to delete chat');
      }
    } catch (error) {
      debugError('LlamB: Error deleting chat from history:', error);
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
      
      debugLog('LlamB: Started new chat');
    } catch (error) {
      debugError('LlamB: Error starting new chat:', error);
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
      debugLog('LlamB: Captured selection:', selectionObj);
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
        debugLog('LlamB: Page too large, using truncated content');
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
      debugError('LlamB: Error extracting page content:', error);
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
    
    // Update plugin chips
    updatePluginChips();
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
    
    // Add click handler to show selection content
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Don't show modal if clicking the close button
      if (e.target.classList.contains('llamb-chip-close')) {
        return;
      }
      showChipContentModal('selection', selection);
    });

    // Add click handler to remove specific selection
    chip.querySelector('.llamb-chip-close').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeSelection(selection.id);
    });
    
    return chip;
  }

  // Plugin context chip management
  function updatePluginChips() {
    if (!pluginManager) return;
    
    const chipsContainer = document.getElementById('llamb-context-chips');
    if (!chipsContainer) return;
    
    // Remove existing plugin chips
    const existingPluginChips = chipsContainer.querySelectorAll('.llamb-chip-plugin');
    existingPluginChips.forEach(chip => chip.remove());
    
    // Add chips for active plugins
    const enabledPlugins = pluginManager.getEnabledPlugins();
    enabledPlugins.forEach(pluginManifest => {
      if (pluginManager.shouldPluginRun(pluginManifest.id)) {
        const plugin = pluginManager.plugins.get(pluginManifest.id);
        if (plugin && plugin.contextChip) {
          const pluginChip = createPluginChip(plugin.contextChip);
          chipsContainer.appendChild(pluginChip);
        }
      }
    });
  }

  // Create plugin chip element
  function createPluginChip(chipData) {
    const chip = document.createElement('div');
    chip.className = 'llamb-chip llamb-chip-plugin';
    chip.dataset.pluginId = chipData.pluginId;
    let statusIcon = '';
    if (chipData.status === 'loading') {
      statusIcon = '<span class="llamb-chip-status">⏳</span>';
    } else if (chipData.status === 'unavailable') {
      statusIcon = '<span class="llamb-chip-status">⚠️</span>';
    } else if (chipData.status === 'ready') {
      statusIcon = '<span class="llamb-chip-status">✓</span>';
    }
    
    chip.innerHTML = `
      <span class="llamb-chip-icon">${chipData.icon}</span>
      <span class="llamb-chip-text">${chipData.text}</span>
      ${statusIcon}
    `;
    
    // Add click handler to show content modal
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showChipContentModal('plugin', {
        ...chipData,
        pluginId: chipData.pluginId
      });
    });
    
    // Add hover tooltip
    if (chipData.description) {
      chip.title = chipData.description;
    }
    
    return chip;
  }

  // Toggle plugin chip active state
  function togglePluginChip(pluginId) {
    const chip = document.querySelector(`.llamb-chip-plugin[data-plugin-id="${pluginId}"]`);
    if (!chip) return;
    
    const isActive = chip.classList.contains('llamb-chip-active');
    
    if (isActive) {
      chip.classList.remove('llamb-chip-active');
    } else {
      // Deactivate other plugin chips if needed
      const otherPluginChips = document.querySelectorAll('.llamb-chip-plugin.llamb-chip-active');
      otherPluginChips.forEach(otherChip => {
        if (otherChip.dataset.pluginId !== pluginId) {
          otherChip.classList.remove('llamb-chip-active');
        }
      });
      
      chip.classList.add('llamb-chip-active');
    }
    
    // Update plugin chip state
    if (pluginManager) {
      const plugin = pluginManager.plugins.get(pluginId);
      if (plugin && plugin.contextChip) {
        plugin.contextChip.isActive = !isActive;
      }
    }
  }

  // Add plugin context chip (called by plugins)
  window.addPluginContextChip = function(pluginId, chipData) {
    if (!pluginManager) return;
    
    const plugin = pluginManager.plugins.get(pluginId);
    if (!plugin) return;
    
    plugin.contextChip = chipData;
    updatePluginChips();
  };

  // Remove plugin context chip (called by plugins)
  window.removePluginContextChip = function(pluginId) {
    if (!pluginManager) return;
    
    const plugin = pluginManager.plugins.get(pluginId);
    if (!plugin) return;
    
    plugin.contextChip = null;
    updatePluginChips();
  };

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
          <button class="llamb-float-toggle" id="llamb-float-btn" title="Switch to floating window">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-float-icon">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18M5.25 6h.008v.008H5.25V6ZM7.5 6h.008v.008H7.5V6Zm2.25 0h.008v.008H9.75V6Z" />
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
      <div class="llamb-chip-content-modal" id="llamb-chip-content-modal" style="display: none;">
        <div class="llamb-chip-modal-header">
          <span id="llamb-chip-modal-title">Chip Content</span>
          <button class="llamb-chip-modal-close" id="llamb-chip-modal-close">×</button>
        </div>
        <div class="llamb-chip-modal-content" id="llamb-chip-modal-content">
          <div class="llamb-loading">Loading content...</div>
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

    // Use data attributes instead of classes to track state (won't interfere with Next.js)
    document.body.setAttribute('data-llamb-sidebar', 'closed');
    return sidebarContainer;
  }

  // Toggle sidebar visibility
  function toggleSidebar() {
    debugLog('LlamB: toggleSidebar called, current isVisible:', isVisible);
    
    // Capture selection before showing sidebar
    if (!isVisible) {
      captureSelection();
      
      // Restore mode preference when opening
      try {
        const savedMode = localStorage.getItem('llamb-mode-preference');
        const savedPosition = localStorage.getItem('llamb-floating-position');
        const savedSize = localStorage.getItem('llamb-floating-size');
        
        if (savedMode === 'floating') {
          isFloatingMode = true;
          debugLog('LlamB: Restored floating mode preference');
        } else if (savedMode === 'sidebar') {
          isFloatingMode = false;
          debugLog('LlamB: Restored sidebar mode preference');
        }
        
        if (savedPosition) {
          floatingPosition = JSON.parse(savedPosition);
          debugLog('LlamB: Restored floating position:', floatingPosition);
        }
        
        if (savedSize) {
          floatingSize = JSON.parse(savedSize);
          debugLog('LlamB: Restored floating size:', floatingSize);
        }
      } catch (e) {
        debugError('LlamB: Error restoring preferences from localStorage:', e);
      }
    }
    
    if (!sidebar) {
      debugLog('LlamB: Creating sidebar...');
      sidebar = createSidebar();
      setupEventListeners();
      // Apply theme after sidebar and buttons are created
      detectAndApplyTheme();
    }

    isVisible = !isVisible;
    debugLog('LlamB: Setting isVisible to:', isVisible);
    
    // Update sidebar based on current mode
    updateSidebarDisplay();
    
    // Save sidebar state
    saveSidebarState();
  }
  
  // Update sidebar display based on current mode
  function updateSidebarDisplay() {
    if (!sidebar) return;

    // Update float button icon to match current mode
    const floatBtn = document.getElementById('llamb-float-btn');
    if (floatBtn) {
      if (isFloatingMode) {
        // When in floating mode, show the "exit" icon (arrow pointing out)
        floatBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-float-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        `;
        floatBtn.title = 'Switch to sidebar mode';
      } else {
        // When in sidebar mode, show the window icon
        floatBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-float-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18M5.25 6h.008v.008H5.25V6ZM7.5 6h.008v.008H7.5V6Zm2.25 0h.008v.008H9.75V6Z" />
          </svg>
        `;
        floatBtn.title = 'Switch to floating window';
      }
    }

    if (isVisible) {
      // Always remove display:none when showing
      sidebar.style.display = '';

      if (isFloatingMode) {
        // Floating window mode
        sidebar.className = 'llamb-floating-window llamb-floating-entering';
        
        // Position using right/top initially
        const rightPos = floatingPosition.x || 20;
        const topPos = floatingPosition.y || 20;
        
        sidebar.style.top = topPos + 'px';
        sidebar.style.right = rightPos + 'px';
        sidebar.style.left = 'auto';
        sidebar.style.bottom = 'auto';
        sidebar.style.width = floatingSize.width + 'px';
        sidebar.style.height = floatingSize.height + 'px';
        
        // Use data attributes for floating mode (won't interfere with Next.js)
        document.body.setAttribute('data-llamb-sidebar', 'open');
        document.body.setAttribute('data-llamb-mode', 'floating');

        // Update button tooltip
        const floatBtn = document.getElementById('llamb-float-btn');
        if (floatBtn) {
          floatBtn.title = 'Switch to sidebar mode';
        }
      } else {
        // Sidebar mode
        sidebar.className = 'llamb-sidebar-visible';
        sidebar.style.top = '0';
        sidebar.style.right = '0';
        sidebar.style.left = 'auto';
        sidebar.style.bottom = 'auto';
        sidebar.style.width = '380px';
        sidebar.style.height = '100vh';
        
        // Use data attributes for sidebar mode (won't interfere with Next.js)
        document.body.setAttribute('data-llamb-sidebar', 'open');
        document.body.setAttribute('data-llamb-mode', 'sidebar');

        // Update button tooltip
        const floatBtn = document.getElementById('llamb-float-btn');
        if (floatBtn) {
          floatBtn.title = 'Switch to floating window';
        }
        
        // Handle layout changes for sidebar mode
        setTimeout(() => {
          handlePageLayoutChange();
        }, 100);
      }
      
      // Update context chips when showing
      setTimeout(() => {
        updateContextChips();
        updatePluginChips();
      }, 100);
      
      // Remove entering animation class and setup interactions
      setTimeout(() => {
        if (sidebar.classList.contains('llamb-floating-entering')) {
          sidebar.classList.remove('llamb-floating-entering');
        }
        // Reinitialize interactions after mode changes
        if (isFloatingMode) {
          setupFloatingWindowInteractions();
        }
      }, 300);
    } else {
      // Hide sidebar
      if (isFloatingMode) {
        // Window mode - instant hide, no animation
        sidebar.style.display = 'none';
        sidebar.className = 'llamb-sidebar-hidden';
      } else {
        // Sidebar mode - keep the sliding animation
        sidebar.className = 'llamb-sidebar-hidden';
        // Don't set display:none for sidebar mode, let the transform handle it
      }
      
      // Update data attributes when closing (won't interfere with Next.js)
      document.body.setAttribute('data-llamb-sidebar', 'closed');
      document.body.removeAttribute('data-llamb-mode');

      // Clear all selections when sidebar closes
      clearAllSelections();
      
      // Reset layout changes
      setTimeout(() => {
        handlePageLayoutChange();
      }, 100);
    }
  }
  
  // Toggle between floating and sidebar modes
  function toggleFloatingMode() {
    debugLog('LlamB: toggleFloatingMode called, current isFloatingMode:', isFloatingMode);

    isFloatingMode = !isFloatingMode;

    // Update the float button icon and title
    const floatBtn = document.getElementById('llamb-float-btn');
    if (floatBtn) {
      if (isFloatingMode) {
        // When in floating mode, show the "exit" icon (arrow pointing out)
        floatBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-float-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        `;
        floatBtn.title = 'Switch to sidebar mode';
      } else {
        // When in sidebar mode, show the window icon
        floatBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="llamb-float-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18M5.25 6h.008v.008H5.25V6ZM7.5 6h.008v.008H7.5V6Zm2.25 0h.008v.008H9.75V6Z" />
          </svg>
        `;
        floatBtn.title = 'Switch to floating window';
      }
    }

    if (isFloatingMode) {
      // Switching TO floating mode - no body modifications needed
      // Reset any layout changes that were made for sidebar mode
      handlePageLayoutChange();
    } else {
      // Switching FROM floating mode back to sidebar mode
      if (isVisible) {
        // Reapply layout changes for sidebar mode
        setTimeout(() => {
          handlePageLayoutChange();
        }, 100);
      }
    }

    // If sidebar is visible, update display immediately
    if (isVisible) {
      updateSidebarDisplay();
    }

    // Save state
    saveSidebarState();
  }

  // Setup event listeners
  function setupEventListeners() {
    const toggleBtn = document.getElementById('llamb-toggle-btn');
    const closeBtn = document.getElementById('llamb-close-btn');
    const themeBtn = document.getElementById('llamb-theme-btn');
    const historyBtn = document.getElementById('llamb-history-btn');
    const newChatBtn = document.getElementById('llamb-new-chat-btn');
    const floatBtn = document.getElementById('llamb-float-btn');
    const sendBtn = document.getElementById('llamb-send-btn');
    const chatInput = document.getElementById('llamb-chat-input');

    debugLog('LlamB: Setting up event listeners...');
    debugLog('LlamB: toggleBtn found:', !!toggleBtn);
    debugLog('LlamB: closeBtn found:', !!closeBtn);
    debugLog('LlamB: themeBtn found:', !!themeBtn);
    debugLog('LlamB: historyBtn found:', !!historyBtn);
    debugLog('LlamB: newChatBtn found:', !!newChatBtn);
    debugLog('LlamB: floatBtn found:', !!floatBtn);
    debugLog('LlamB: sendBtn found:', !!sendBtn);
    
    // Debug: Check if buttons exist in DOM
    const allBtns = document.querySelectorAll('button[id*="llamb"]');
    debugLog('LlamB: All llamb buttons in DOM:', allBtns.length);
    allBtns.forEach(btn => {
      debugLog('LlamB: Found button:', btn.id, btn.className);
    });
    
    // Fallback: Try again with slight delay if buttons not found
    if (!toggleBtn || !closeBtn || !themeBtn || !floatBtn) {
      debugLog('LlamB: Some buttons not found, retrying in 100ms...');
      setTimeout(() => {
        setupEventListeners();
      }, 100);
      return;
    }
    
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        debugLog('LlamB: Toggle button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        debugLog('LlamB: Close button clicked!');
        e.preventDefault();
        e.stopPropagation();
        
        // Set visibility to false
        isVisible = false;
        
        // Update sidebar display properly using the same function as toggle
        updateSidebarDisplay();
        
        // Save state
        saveSidebarState();
      });
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', (e) => {
        debugLog('LlamB: Theme button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      });
    }

    if (historyBtn) {
      historyBtn.addEventListener('click', (e) => {
        debugLog('LlamB: History button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleHistoryDropdown();
      });
    }

    if (newChatBtn) {
      newChatBtn.addEventListener('click', (e) => {
        debugLog('LlamB: New chat button clicked!');
        e.preventDefault();
        e.stopPropagation();
        startNewChat();
      });
    }

    if (floatBtn) {
      floatBtn.addEventListener('click', (e) => {
        debugLog('LlamB: Float button clicked!');
        e.preventDefault();
        e.stopPropagation();
        toggleFloatingMode();
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

    // Close history dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const historyDropdown = document.getElementById('llamb-history-dropdown');
      const historyBtn = document.getElementById('llamb-history-btn');
      
      if (historyDropdown && historyDropdown.style.display !== 'none') {
        // Check if click is outside the dropdown and not on the history button
        if (!historyDropdown.contains(e.target) && !historyBtn.contains(e.target)) {
          hideHistoryDropdown();
        }
      }
    });

    const historySearch = document.getElementById('llamb-history-search');
    if (historySearch) {
      historySearch.addEventListener('input', (e) => {
        filterChatHistory(e.target.value);
      });
    }

    // Chip content modal close button
    const chipModalClose = document.getElementById('llamb-chip-modal-close');
    if (chipModalClose) {
      chipModalClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideChipContentModal();
      });
    }

    // Add escape key handler for modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const chipModal = document.getElementById('llamb-chip-content-modal');
        if (chipModal && chipModal.style.display === 'flex') {
          hideChipContentModal();
        }
      }
    });

    // Page chip click handler
    const pageChip = document.querySelector('.llamb-chip-page');
    if (pageChip) {
      pageChip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showChipContentModal('page', {
          title: document.title,
          url: window.location.href,
          domain: window.location.hostname
        });
      });
    }
    
    // Setup floating window drag and resize functionality
    setupFloatingWindowInteractions();
  }
  
  // Initialize global drag handlers once (function to be called later)
  function initializeGlobalDragHandlers() {
    if (window.llambDragHandlersInitialized) return;
    
    window.llambDragHandlersInitialized = true;
    window.llambDragState = {
      isDragging: false,
      isResizing: false,
      dragStart: { x: 0, y: 0 },
      resizeStart: { x: 0, y: 0, width: 0, height: 0 }
    };
    
    // Store sidebar reference globally for drag handlers
    window.llambSidebar = sidebar;
    
    // Global mouse move handler
    document.addEventListener('mousemove', (e) => {
      const dragSidebar = window.llambSidebar || sidebar || document.getElementById('llamb-chat-sidebar');
      if (window.llambDragState && window.llambDragState.isDragging && dragSidebar) {
        debugLog('LlamB: Global drag move detected at:', e.clientX, e.clientY);
        
        // Calculate new position
        const newLeft = e.clientX - window.llambDragState.dragStart.x;
        const newTop = e.clientY - window.llambDragState.dragStart.y;
        
        // Keep within viewport bounds
        const maxLeft = window.innerWidth - dragSidebar.offsetWidth;
        const maxTop = window.innerHeight - dragSidebar.offsetHeight;
        
        const boundedLeft = Math.max(0, Math.min(maxLeft, newLeft));
        const boundedTop = Math.max(0, Math.min(maxTop, newTop));
        
        debugLog('LlamB: Setting new position - left:', boundedLeft, 'top:', boundedTop);
        
        // Apply position using left/top instead of right/top
        dragSidebar.style.left = boundedLeft + 'px';
        dragSidebar.style.top = boundedTop + 'px';
        dragSidebar.style.right = 'auto';
        dragSidebar.style.bottom = 'auto';
        
        // Update stored position (convert to right-based for consistency)
        floatingPosition.x = window.innerWidth - boundedLeft - dragSidebar.offsetWidth;
        floatingPosition.y = boundedTop;
        
        e.preventDefault();
      }
      
      if (window.llambDragState && window.llambDragState.isResizing) {
        // Always get fresh reference to sidebar
        const resizeSidebar = document.getElementById('llamb-chat-sidebar');
        if (!resizeSidebar) {
          debugLog('LlamB: Could not find sidebar for resizing');
          return;
        }
        
        debugLog('LlamB: Global resize move detected at:', e.clientX, e.clientY);
        const deltaX = e.clientX - window.llambDragState.resizeStart.x;
        const deltaY = e.clientY - window.llambDragState.resizeStart.y;
        
        const newWidth = window.llambDragState.resizeStart.width + deltaX;
        const newHeight = window.llambDragState.resizeStart.height + deltaY;
        
        debugLog('LlamB: New size:', newWidth, 'x', newHeight);
        
        // Apply min/max constraints
        const constrainedWidth = Math.max(320, Math.min(800, newWidth));
        const constrainedHeight = Math.max(400, Math.min(window.innerHeight * 0.9, newHeight));
        
        debugLog('LlamB: Applying size:', constrainedWidth, 'x', constrainedHeight);
        
        // Apply the new size
        resizeSidebar.style.width = constrainedWidth + 'px';
        resizeSidebar.style.height = constrainedHeight + 'px';
        
        // Update stored sizes
        floatingSize.width = constrainedWidth;
        floatingSize.height = constrainedHeight;
        
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    // Global mouse up handler
    document.addEventListener('mouseup', (e) => {
      if (window.llambDragState && (window.llambDragState.isDragging || window.llambDragState.isResizing)) {
        debugLog('LlamB: Global mouse up - stopping drag/resize');
        window.llambDragState.isDragging = false;
        window.llambDragState.isResizing = false;
        document.body.style.cursor = 'auto';
        document.body.style.userSelect = 'auto';
        if (sidebar) {
          sidebar.style.cursor = 'auto';
        }
        saveSidebarState();
        e.preventDefault();
      }
    }, true);
  }
  
  // Setup dragging and resizing for floating window
  function setupFloatingWindowInteractions() {
    debugLog('LlamB: Setting up floating window interactions');
    
    if (!sidebar) return;
    
    // Update global sidebar reference
    window.llambSidebar = sidebar;
    
    // Initialize global handlers if not already done
    initializeGlobalDragHandlers();
    
    // Remove old listeners if they exist
    if (window.llambFloatingMouseDown) {
      sidebar.removeEventListener('mousedown', window.llambFloatingMouseDown);
    }
    
    // Handle header dragging and resize handle
    window.llambFloatingMouseDown = function handleMouseDown(e) {
      debugLog('LlamB: Mouse down event', e.target, e.target.className, e.target.tagName);
      
      if (!sidebar || !sidebar.classList.contains('llamb-floating-window')) {
        debugLog('LlamB: Not in floating mode or no sidebar');
        return;
      }
      
      // Check if clicking directly on the sidebar
      if (!sidebar.contains(e.target)) {
        return;
      }
      
      // Get elements
      const header = sidebar.querySelector('.llamb-sidebar-header');
      
      // Simplified check: if clicking on header and not on a button, allow dragging
      let isHeaderClick = false;
      
      if (header && header.contains(e.target)) {
        // Check if we're NOT clicking on a button or action area
        const isButton = e.target.closest('button');
        const isAction = e.target.closest('.llamb-header-actions');
        
        if (!isButton && !isAction) {
          isHeaderClick = true;
          debugLog('LlamB: Valid header drag area clicked');
        } else {
          debugLog('LlamB: Clicked on button/action area, not dragging');
        }
      }
      
      // Check if clicking on resize handle area (bottom-right corner)
      const rect = sidebar.getBoundingClientRect();
      const isResizeHandle = e.clientX > rect.right - 30 && 
                            e.clientX <= rect.right && 
                            e.clientY > rect.bottom - 30 && 
                            e.clientY <= rect.bottom;
      
      debugLog('LlamB: Mouse position:', e.clientX, e.clientY);
      debugLog('LlamB: Sidebar rect:', rect.right, rect.bottom);
      debugLog('LlamB: Header click:', isHeaderClick, 'Resize handle:', isResizeHandle);
      
      if (isResizeHandle) {
        debugLog('LlamB: Starting resize from size:', rect.width, 'x', rect.height);
        // Start resizing
        window.llambDragState.isResizing = true;
        window.llambDragState.resizeStart = {
          x: e.clientX,
          y: e.clientY,
          width: rect.width,
          height: rect.height
        };
        e.preventDefault();
        e.stopPropagation();
        document.body.style.cursor = 'se-resize';
        document.body.style.userSelect = 'none';
      } else if (isHeaderClick) {
        debugLog('LlamB: Starting drag from position:', e.clientX, e.clientY);
        // Start dragging
        window.llambDragState.isDragging = true;
        const rect = sidebar.getBoundingClientRect();
        window.llambDragState.dragStart = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        e.preventDefault();
        e.stopPropagation();
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }
    };
    
    // Add mousedown listener directly to sidebar
    sidebar.addEventListener('mousedown', window.llambFloatingMouseDown);
    
    // Add hover detection for resize handle
    sidebar.addEventListener('mousemove', (e) => {
      if (sidebar.classList.contains('llamb-floating-window') && 
          !window.llambDragState.isDragging && 
          !window.llambDragState.isResizing) {
        const rect = sidebar.getBoundingClientRect();
        const isNearResize = e.clientX > rect.right - 30 && 
                            e.clientX <= rect.right && 
                            e.clientY > rect.bottom - 30 && 
                            e.clientY <= rect.bottom;
        
        if (isNearResize) {
          sidebar.style.cursor = 'se-resize';
        } else if (!e.target.closest('.llamb-sidebar-header')) {
          sidebar.style.cursor = 'auto';
        }
      }
    });
    
    debugLog('LlamB: Floating window interaction listeners added');
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
    debugLog('LlamB: sendMessage called');
    const chatInput = document.getElementById('llamb-chat-input');
    const messagesContainer = document.getElementById('llamb-messages');
    const message = chatInput.value.trim();

    debugLog('LlamB: Message content:', message);
    if (!message) {
      debugLog('LlamB: Empty message, returning');
      return;
    }

    // Disable input while processing
    chatInput.disabled = true;
    const sendBtn = document.getElementById('llamb-send-btn');
    sendBtn.disabled = true;

    // Get page context
    const pageContext = await getPageContext();

    // Create new chat if none exists
    if (!currentChat) {
      if (chatManager) {
        currentChat = await createNewChat();
        saveSidebarState();
      } else {
        // Fallback: create simple chat object
        debugLog('LlamB: No ChatManager, creating simple chat object...');
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
          debugLog('LlamB: Saved chat to storage (fallback)');
        } catch (error) {
          debugError('LlamB: Failed to save chat (fallback):', error);
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
      debugLog('LlamB: Sending message:', message);
      
      // Get page context
      const pageContext = await getPageContext();
      debugLog('LlamB: Page context:', pageContext);
      
      // Send to background script for LLM processing
      debugLog('LlamB: Sending to background...');
      const response = await chrome.runtime.sendMessage({
        action: 'sendChatMessage',
        message: message,
        pageContext: pageContext,
        options: {
          streaming: true,
          includeContext: true
        }
      });

      debugLog('LlamB: Response from background:', response);

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to send message');
      }

      debugLog('LlamB: Message sent, requestId:', response.requestId);

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
      debugError('LlamB: Error sending message:', error);
      
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

    debugLog('LlamB: Stream ended for request:', data.requestId);
    
    // Save assistant message to chat
    if (currentChat && data.fullContent) {
      try {
        if (chatManager) {
          await chatManager.addMessage(currentChat, 'assistant', data.fullContent);
          debugLog('LlamB: Saved assistant message to chat');
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
          debugLog('LlamB: Saved assistant message to chat (fallback)');
        }
      } catch (error) {
        debugError('LlamB: Error saving assistant message:', error);
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

    debugError('LlamB: Stream error:', data.error);
    
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
  async function getPageContext() {
    // Combine all preserved selections
    const allSelections = preservedSelections.map(sel => sel.text).join('\n\n---\n\n');
    
    const context = {
      url: window.location.href,
      title: document.title,
      selectedText: allSelections || getSelectedText(),
      markdownContent: extractPageContent(),
      timestamp: new Date().toISOString()
    };
    
    // Add plugin content if any plugin chips are active
    if (pluginManager) {
      const activePluginChips = document.querySelectorAll('.llamb-chip-plugin.llamb-chip-active');
      let pluginContent = '';
      
      for (const chip of activePluginChips) {
        const pluginId = chip.dataset.pluginId;
        try {
          const content = await pluginManager.getPluginContent(pluginId);
          if (content) {
            pluginContent += (pluginContent ? '\n\n---\n\n' : '') + content;
          }
        } catch (error) {
          debugError(`LlamB: Error getting content from plugin ${pluginId}:`, error);
        }
      }
      
      if (pluginContent) {
        context.pluginContent = pluginContent;
      }
    }
    
    return context;
  }

  // Handle page layout changes - simplified to rely on body margin
  function handlePageLayoutChange() {
    // If in floating mode, reset everything to normal
    if (isFloatingMode) {
      // Reset site-specific layouts
      resetSiteSpecificLayout();
      return;
    }
    
    // Site-specific adjustments only when needed
    if (!isFloatingMode) {
      handleSiteSpecificLayout();
    }
  }
  
  // Reset site-specific layout changes
  function resetSiteSpecificLayout() {
    // Clean up any data attributes we may have set
    const modifiedElements = document.querySelectorAll('[data-llamb-modified]');
    modifiedElements.forEach(element => {
      delete element.dataset.llambModified;
    });
  }
  
  // Handle site-specific layout adjustments - minimal approach
  function handleSiteSpecificLayout() {
    // Most sites work fine with just the body margin adjustment from CSS
    // Only add specific adjustments if absolutely necessary and well-tested
    
    // Don't mark body with dataset to prevent Next.js hydration errors
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
  chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    try {
      debugLog('LlamB: Received message:', request);
      
      if (request.action === 'toggleSidebar') {
        toggleSidebar();
        setTimeout(() => handlePageLayoutChange(), 100);
        sendResponse({ success: true });
      } else if (request.action === 'getPageContext') {
        const context = await getPageContext();
        debugLog('LlamB: Sending context:', context);
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
      } else if (request.action === 'pluginStateChanged') {
        // Handle plugin enable/disable from settings page
        handlePluginStateChanged(request);
        sendResponse({ success: true });
      } else if (request.action === 'pageUpdated') {
        // Handle page navigation updates
        handlePageUpdated(request);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      debugError('LlamB: Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true; // Keep the message channel open for async response
  });

  // Use data attributes instead of classes (won't interfere with Next.js hydration)

  // Clear content cache when URL changes
  let lastUrl = window.location.href;
  new MutationObserver(async () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      pageContentCache = {
        url: null,
        content: null,
        timestamp: null
      };
      
      // Notify plugins of page change
      if (pluginManager) {
        debugLog('LlamB: URL changed, notifying plugins...');
        await pluginManager.onPageChange();
        updatePluginChips();
      }
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
      // Update plugin chips after sidebar is created
      if (pluginManager) {
        updatePluginChips();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', initialize);

  // If DOM is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  // Handle plugin state changes from background script
  async function handlePluginStateChanged(request) {
    const { pluginId, enabled } = request;
    debugLog('LlamB: Plugin state changed:', pluginId, enabled ? 'enabled' : 'disabled');
    
    if (!pluginManager) {
      debugWarn('LlamB: PluginManager not available, cannot handle state change');
      return;
    }
    
    try {
      if (enabled) {
        await pluginManager.enablePlugin(pluginId);
        debugLog('LlamB: Plugin enabled in content script:', pluginId);
      } else {
        await pluginManager.disablePlugin(pluginId);
        debugLog('LlamB: Plugin disabled in content script:', pluginId);
      }
      
      // Trigger a page change to update plugin states
      await pluginManager.onPageChange();
    } catch (error) {
      debugError('LlamB: Error handling plugin state change:', error);
    }
  }
  
  // Handle page updates
  async function handlePageUpdated(request) {
    debugLog('LlamB: Page updated, notifying plugins:', request.url);
    
    if (pluginManager) {
      try {
        await pluginManager.onPageChange();
      } catch (error) {
        debugError('LlamB: Error notifying plugins of page update:', error);
      }
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
    // No body class cleanup needed anymore
  });

})();