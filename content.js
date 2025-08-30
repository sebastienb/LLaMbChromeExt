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

  // Create sidebar container
  function createSidebar() {
    const sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'llamb-chat-sidebar';
    sidebarContainer.className = 'llamb-sidebar-hidden';
    
    // Load sidebar content
    sidebarContainer.innerHTML = `
      <div class="llamb-sidebar-header">
        <div class="llamb-sidebar-title">
          <span class="llamb-logo">🦙</span>
          <span>LlamB Assistant</span>
        </div>
        <button class="llamb-sidebar-close" id="llamb-close-btn">×</button>
      </div>
      <div class="llamb-sidebar-content">
        <div class="llamb-chat-messages" id="llamb-messages">
          <div class="llamb-message llamb-assistant-message">
            <div class="llamb-message-content">
              Hello! I'm your AI assistant. I can see the current webpage and help you analyze it. How can I assist you today?
            </div>
            <div class="llamb-message-meta">Assistant</div>
          </div>
        </div>
        <div class="llamb-chat-input-container">
          <div class="llamb-context-info" id="llamb-context">
            <span class="llamb-context-indicator">📄</span>
            <span class="llamb-context-text">Current page: ${document.title}</span>
          </div>
          <div class="llamb-input-wrapper">
            <textarea 
              id="llamb-chat-input" 
              placeholder="Ask about this page or anything else..."
              rows="1"
            ></textarea>
            <button id="llamb-send-btn" class="llamb-send-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="m22 2-7 20-4-9-9-4 20-7z"/>
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
    
    if (!sidebar) {
      console.log('LlamB: Creating sidebar...');
      sidebar = createSidebar();
      setupEventListeners();
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
    } else {
      document.body.classList.remove('llamb-sidebar-open');
      document.body.classList.add('llamb-sidebar-closed');
      console.log('LlamB: Added llamb-sidebar-closed to body');
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    const toggleBtn = document.getElementById('llamb-toggle-btn');
    const closeBtn = document.getElementById('llamb-close-btn');
    const sendBtn = document.getElementById('llamb-send-btn');
    const chatInput = document.getElementById('llamb-chat-input');

    console.log('LlamB: Setting up event listeners...');
    console.log('LlamB: toggleBtn found:', !!toggleBtn);
    console.log('LlamB: closeBtn found:', !!closeBtn);
    
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
        sidebar.className = 'llamb-sidebar-hidden';
        
        // Update body classes to restore normal layout
        document.body.classList.remove('llamb-sidebar-open');
        document.body.classList.add('llamb-sidebar-closed');
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
    userMessageDiv.className = 'llamb-message llamb-user-message';
    userMessageDiv.innerHTML = `
      <div class="llamb-message-content">${escapeHtml(message)}</div>
      <div class="llamb-message-meta">You</div>
    `;
    messagesContainer.appendChild(userMessageDiv);

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Create assistant message placeholder for streaming
    const assistantMessageDiv = document.createElement('div');
    assistantMessageDiv.className = 'llamb-message llamb-assistant-message';
    assistantMessageDiv.innerHTML = `
      <div class="llamb-message-content llamb-message-streaming">
        <div class="llamb-typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
      <div class="llamb-message-meta">Assistant</div>
    `;
    messagesContainer.appendChild(assistantMessageDiv);
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
      
      // Store requestId for tracking streaming updates
      assistantMessageDiv.dataset.requestId = response.requestId;

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
    
    // Remove typing indicator on first chunk
    if (contentDiv.classList.contains('llamb-message-streaming')) {
      contentDiv.classList.remove('llamb-message-streaming');
      contentDiv.innerHTML = '';
    }

    // Update content with streaming text
    const textContent = contentDiv.querySelector('.llamb-text-content') || document.createElement('div');
    if (!textContent.parentNode) {
      textContent.className = 'llamb-text-content';
      contentDiv.appendChild(textContent);
    }

    // Escape and append new content
    textContent.innerHTML = escapeHtml(data.fullContent).replace(/\n/g, '<br>');

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
    return {
      url: window.location.href,
      title: document.title,
      selectedText: getSelectedText(),
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

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    // Create toggle button immediately
    if (!sidebar) {
      sidebar = createSidebar();
      setupEventListeners();
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