// Chat Manager - Handle chat persistence and history
class ChatManager {
  constructor() {
    this.storageKey = 'llamb-chats';
    this.activeChat = null;
    this.maxChats = 100; // LRU cleanup after this limit
  }

  // Generate UUID v4
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Create a new chat
  async createChat(initialMessage, pageContext) {
    const chatId = this.generateUUID();
    const now = new Date().toISOString();
    
    // Generate title from first message or page title
    const title = this.generateChatTitle(initialMessage, pageContext);
    
    const chat = {
      id: chatId,
      title: title,
      urls: [], // URLs where content was shared
      createdAt: now,
      updatedAt: now,
      messages: [],
      pageContexts: [], // Snapshots from pages where content was used
      messageCount: 0
    };

    // Add initial message if provided
    if (initialMessage) {
      await this.addMessage(chat, 'user', initialMessage, pageContext);
    }

    // Save chat
    await this.saveChat(chat);
    this.activeChat = chat;
    
    console.log('ChatManager: Created new chat:', chatId);
    return chat;
  }

  // Generate chat title from message and context
  generateChatTitle(message, pageContext) {
    if (message) {
      // Use first 50 chars of message
      const title = message.substring(0, 50).trim();
      return title.length < message.length ? title + '...' : title;
    } else if (pageContext && pageContext.title) {
      return `Chat about ${pageContext.title}`;
    } else {
      return `Chat ${new Date().toLocaleDateString()}`;
    }
  }

  // Load existing chat
  async loadChat(chatId) {
    try {
      const chats = await this.getAllChats();
      const chat = chats.find(c => c.id === chatId);
      
      if (chat) {
        this.activeChat = chat;
        console.log('ChatManager: Loaded chat:', chatId);
        return chat;
      } else {
        console.warn('ChatManager: Chat not found:', chatId);
        return null;
      }
    } catch (error) {
      console.error('ChatManager: Error loading chat:', error);
      return null;
    }
  }

  // Save chat to storage
  async saveChat(chat) {
    try {
      const chats = await this.getAllChats();
      const existingIndex = chats.findIndex(c => c.id === chat.id);
      
      // Update timestamp
      chat.updatedAt = new Date().toISOString();
      
      if (existingIndex !== -1) {
        chats[existingIndex] = chat;
      } else {
        chats.push(chat);
      }

      // Sort by updatedAt (most recent first)
      chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      // Implement LRU cleanup
      if (chats.length > this.maxChats) {
        chats.splice(this.maxChats);
      }

      await chrome.storage.local.set({
        [this.storageKey]: chats
      });

      console.log('ChatManager: Saved chat:', chat.id);
      return true;
    } catch (error) {
      console.error('ChatManager: Error saving chat:', error);
      return false;
    }
  }

  // Add message to chat
  async addMessage(chat, role, content, pageContext) {
    const message = {
      id: this.generateUUID(),
      role: role, // 'user' or 'assistant'
      content: content,
      timestamp: new Date().toISOString(),
      sourceUrl: pageContext ? pageContext.url : null
    };

    chat.messages.push(message);
    chat.messageCount = chat.messages.length;

    // Track URL and page context if this message includes page content
    if (pageContext && this.messageIncludesPageContent(content, pageContext)) {
      // Add URL if not already tracked
      if (!chat.urls.includes(pageContext.url)) {
        chat.urls.push(pageContext.url);
      }

      // Add page context if not already stored for this URL
      const existingContext = chat.pageContexts.find(ctx => ctx.url === pageContext.url);
      if (!existingContext) {
        chat.pageContexts.push({
          url: pageContext.url,
          title: pageContext.title,
          timestamp: new Date().toISOString(),
          markdownContent: pageContext.markdownContent || '',
          selectedText: pageContext.selectedText || ''
        });
      }
    }

    // Auto-save chat
    await this.saveChat(chat);
    
    console.log('ChatManager: Added message to chat:', chat.id);
    return message;
  }

  // Check if message includes page content (context chips were used)
  messageIncludesPageContent(content, pageContext) {
    if (!pageContext) return false;
    
    // Check if message references page content
    const hasPageReference = content.toLowerCase().includes('page') || 
                            content.toLowerCase().includes('website') ||
                            content.toLowerCase().includes('this') ||
                            (pageContext.selectedText && pageContext.selectedText.length > 0);
    
    return hasPageReference;
  }

  // Get all chats
  async getAllChats() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      return result[this.storageKey] || [];
    } catch (error) {
      console.error('ChatManager: Error getting chats:', error);
      return [];
    }
  }

  // Get chat history sorted by recency
  async getChatHistory() {
    const chats = await this.getAllChats();
    return chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  // Get chats for specific domain
  async getChatsByDomain(domain) {
    const chats = await this.getAllChats();
    return chats.filter(chat => 
      chat.urls.some(url => {
        try {
          return new URL(url).hostname === domain;
        } catch {
          return false;
        }
      })
    ).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  // Delete chat
  async deleteChat(chatId) {
    try {
      const chats = await this.getAllChats();
      const filteredChats = chats.filter(c => c.id !== chatId);
      
      await chrome.storage.local.set({
        [this.storageKey]: filteredChats
      });

      // Clear active chat if it was deleted
      if (this.activeChat && this.activeChat.id === chatId) {
        this.activeChat = null;
      }

      console.log('ChatManager: Deleted chat:', chatId);
      return true;
    } catch (error) {
      console.error('ChatManager: Error deleting chat:', error);
      return false;
    }
  }

  // Export chat as markdown
  async exportChatAsMarkdown(chatId) {
    const chat = await this.loadChat(chatId);
    if (!chat) return null;

    let markdown = `# ${chat.title}\n\n`;
    markdown += `**Created:** ${new Date(chat.createdAt).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(chat.updatedAt).toLocaleString()}\n`;
    
    if (chat.urls.length > 0) {
      markdown += `**Sources:** ${chat.urls.length} pages\n`;
      chat.urls.forEach(url => {
        markdown += `- ${url}\n`;
      });
    }
    
    markdown += '\n---\n\n';

    // Add messages
    chat.messages.forEach(message => {
      const role = message.role === 'user' ? '**You**' : '**AI**';
      const timestamp = new Date(message.timestamp).toLocaleString();
      
      markdown += `## ${role} - ${timestamp}\n\n`;
      markdown += `${message.content}\n\n`;
      
      if (message.sourceUrl) {
        markdown += `*Source: ${message.sourceUrl}*\n\n`;
      }
    });

    return markdown;
  }

  // Get active chat
  getActiveChat() {
    return this.activeChat;
  }

  // Set active chat
  setActiveChat(chat) {
    this.activeChat = chat;
  }

  // Clear active chat
  clearActiveChat() {
    this.activeChat = null;
  }

  // Get storage usage info
  async getStorageInfo() {
    const chats = await this.getAllChats();
    const totalChats = chats.length;
    const totalMessages = chats.reduce((sum, chat) => sum + chat.messageCount, 0);
    
    return {
      totalChats,
      totalMessages,
      oldestChat: chats.length > 0 ? chats[chats.length - 1].createdAt : null,
      newestChat: chats.length > 0 ? chats[0].updatedAt : null
    };
  }

  // Cleanup old chats (keep only most recent N chats)
  async cleanupOldChats(keepCount = 50) {
    try {
      const chats = await this.getAllChats();
      if (chats.length <= keepCount) return false;

      const chatsToKeep = chats.slice(0, keepCount);
      await chrome.storage.local.set({
        [this.storageKey]: chatsToKeep
      });

      console.log(`ChatManager: Cleaned up ${chats.length - keepCount} old chats`);
      return true;
    } catch (error) {
      console.error('ChatManager: Error cleaning up chats:', error);
      return false;
    }
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  // Content script context
  window.ChatManager = ChatManager;
  console.log('ChatManager: Class assigned to window.ChatManager');
} else if (typeof globalThis !== 'undefined') {
  // Service worker context
  globalThis.ChatManager = ChatManager;
  console.log('ChatManager: Class assigned to globalThis.ChatManager');
}