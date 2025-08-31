// YouTube Captions Plugin - Extract captions from YouTube videos
console.log('YoutubeCaptionsPlugin: Loading plugin script');
console.log('YoutubeCaptionsPlugin: LlambPluginBase available?', typeof LlambPluginBase !== 'undefined');

class YoutubeCaptionsPlugin extends LlambPluginBase {
  constructor(api, manifest) {
    super(api, manifest);
    this.captionsCache = null;
    this.currentVideoId = null;
    this.speechBubbleIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>`;
  }

  /**
   * Check if this plugin should run on the current page
   */
  shouldRunOnCurrentPage() {
    const hostname = window.location.hostname;
    const isYouTube = hostname === 'youtube.com' || 
                     hostname === 'www.youtube.com' || 
                     hostname === 'm.youtube.com' ||
                     hostname.endsWith('.youtube.com');
    const isVideo = this.isVideoPage();
    
    this.log('Domain check:', hostname, 'isYouTube:', isYouTube, 'isVideo:', isVideo);
    return isYouTube && isVideo;
  }

  /**
   * Check if current page is a YouTube video page
   */
  isVideoPage() {
    return window.location.pathname === '/watch' && 
           new URLSearchParams(window.location.search).has('v');
  }

  /**
   * Get current video ID from URL
   */
  getCurrentVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  /**
   * Get context chip data for YouTube captions
   */
  getContextChipData() {
    if (!this.shouldRunOnCurrentPage()) {
      return null;
    }

    let status = 'loading';
    let description = 'Extracting captions from this YouTube video...';
    
    if (this.captionsCache) {
      status = 'ready';
      description = 'Video captions available';
    } else if (this.captionsCache === false) {
      status = 'unavailable';
      description = 'No captions available for this video';
    }

    return {
      icon: this.speechBubbleIcon,
      text: 'Video Captions',
      description: description,
      status: status
    };
  }
  
  /**
   * Update the context chip with current status
   */
  updateContextChip() {
    const chipData = this.getContextChipData();
    if (chipData) {
      this.addContextChip(chipData);
      
      // Also trigger a UI update if the function exists
      if (typeof window.updatePluginChips === 'function') {
        window.updatePluginChips();
      }
    }
  }

  /**
   * Called when page changes - check for new video
   */
  async onPageChange() {
    this.log('Page change detected:', window.location.href);
    await super.onPageChange();
    
    if (this.shouldRunOnCurrentPage()) {
      const videoId = this.getCurrentVideoId();
      this.log('Current video ID:', videoId, 'Previous:', this.currentVideoId);
      
      if (videoId !== this.currentVideoId) {
        this.currentVideoId = videoId;
        this.captionsCache = null;
        this.log('New video detected, extracting captions...');
        await this.extractCaptions();
      }
    } else {
      this.log('Plugin should not run on current page');
    }
  }

  /**
   * Get extracted captions content
   */
  async getContent() {
    if (!this.shouldRunOnCurrentPage()) {
      return null;
    }

    if (!this.captionsCache) {
      await this.extractCaptions();
    }

    return this.captionsCache;
  }

  /**
   * Extract captions from YouTube video
   */
  async extractCaptions() {
    return this.safeAsyncOperation(async () => {
      const videoId = this.getCurrentVideoId();
      if (!videoId) {
        this.warn('No video ID found');
        return null;
      }

      this.log('Extracting captions for video:', videoId);

      // Try to get captions from ytInitialPlayerResponse
      let captions = await this.getCaptionsFromPlayerResponse();
      
      if (!captions) {
        // Fallback: try to extract from page HTML
        captions = await this.getCaptionsFromPageHTML();
      }

      if (captions) {
        const videoTitle = this.getVideoTitle();
        // Format captions with clear labeling
        const formattedCaptions = `## YouTube Video Captions\n\n**Video Title:** ${videoTitle}\n**Video ID:** ${videoId}\n\n${captions}`;
        
        this.captionsCache = this.formatContentForChat(formattedCaptions, {
          title: `YouTube Video Captions`,
          type: 'captions',
          includeMetadata: false // We're adding our own metadata
        });
        
        this.log('Successfully extracted captions');
        this.emit('captions-extracted', { videoId, captions });
        
        // Update the context chip to show ready status
        this.updateContextChip();
      } else {
        this.warn('No captions found for this video');
        this.captionsCache = false; // Set to false to indicate we checked but found no captions
        
        // Update chip to show no captions available
        this.updateContextChip();
      }

      return this.captionsCache;
    }, 'caption extraction');
  }

  /**
   * Get captions from ytInitialPlayerResponse
   */
  async getCaptionsFromPlayerResponse() {
    try {
      // Access ytInitialPlayerResponse from the page
      if (!window.ytInitialPlayerResponse) {
        this.log('ytInitialPlayerResponse not available, trying to fetch...');
        return await this.fetchPlayerResponse();
      }

      const player = window.ytInitialPlayerResponse;
      const captionTracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (!captionTracks || captionTracks.length === 0) {
        this.log('No caption tracks found in ytInitialPlayerResponse');
        return null;
      }

      this.log('Found caption tracks:', captionTracks.length);

      // Sort tracks by preference (English first, manual captions preferred)
      const sortedTracks = this.sortCaptionTracks(captionTracks);
      
      // Try to fetch captions from the best track
      for (const track of sortedTracks) {
        const captions = await this.fetchCaptionsFromTrack(track);
        if (captions) {
          return captions;
        }
      }

      return null;
    } catch (error) {
      this.error('Error getting captions from player response:', error);
      return null;
    }
  }

  /**
   * Fetch ytInitialPlayerResponse if not available
   */
  async fetchPlayerResponse() {
    try {
      const videoId = this.getCurrentVideoId();
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const html = await response.text();
      
      const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+(?:meta|head)|<\/script|\n)/);
      if (match) {
        const playerResponse = JSON.parse(match[1]);
        return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      }
    } catch (error) {
      this.error('Error fetching player response:', error);
    }
    return null;
  }

  /**
   * Sort caption tracks by preference
   */
  sortCaptionTracks(tracks) {
    const preferredLanguage = this.getSetting('preferredLanguage', 'en');
    const includeAutoGenerated = this.getSetting('includeAutoGenerated', true);
    
    return tracks
      .filter(track => includeAutoGenerated || !track.vssId.includes('a.'))
      .sort((a, b) => {
        // Prefer specified language
        const aLang = a.languageCode || '';
        const bLang = b.languageCode || '';
        
        if (aLang === preferredLanguage && bLang !== preferredLanguage) return -1;
        if (bLang === preferredLanguage && aLang !== preferredLanguage) return 1;
        
        // Prefer manual captions over auto-generated
        const aAuto = a.vssId?.includes('a.');
        const bAuto = b.vssId?.includes('a.');
        
        if (!aAuto && bAuto) return -1;
        if (!bAuto && aAuto) return 1;
        
        // Prefer English variants
        if (aLang.startsWith('en') && !bLang.startsWith('en')) return -1;
        if (bLang.startsWith('en') && !aLang.startsWith('en')) return 1;
        
        return 0;
      });
  }

  /**
   * Fetch captions from a specific track
   */
  async fetchCaptionsFromTrack(track) {
    try {
      const captionUrl = track.baseUrl + '&fmt=json3';
      this.log('Fetching captions from:', captionUrl);
      
      const response = await fetch(captionUrl);
      if (!response.ok) {
        this.warn('Failed to fetch captions:', response.status);
        return null;
      }
      
      const captionData = await response.json();
      return this.parseCaptionData(captionData, track);
    } catch (error) {
      this.error('Error fetching captions from track:', error);
      return null;
    }
  }

  /**
   * Parse caption data from JSON response
   */
  parseCaptionData(captionData, track) {
    try {
      if (!captionData.events) {
        return null;
      }

      const includeTimestamps = this.getSetting('includeTimestamps', false);
      let transcript = '';

      const textEvents = captionData.events.filter(event => event.segs);
      
      for (const event of textEvents) {
        const text = event.segs.map(seg => seg.utf8 || '').join('');
        if (text.trim()) {
          if (includeTimestamps && event.tStartMs) {
            const timestamp = this.formatTimestamp(event.tStartMs);
            transcript += `[${timestamp}] ${text.trim()}\n`;
          } else {
            transcript += `${text.trim()} `;
          }
        }
      }

      // Clean up the transcript
      transcript = transcript
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      if (transcript) {
        const captionInfo = this.getCaptionTrackInfo(track);
        let formattedTranscript = `### Caption Details\n`;
        formattedTranscript += `- **Language:** ${captionInfo.language}\n`;
        formattedTranscript += `- **Type:** ${captionInfo.type}\n\n`;
        formattedTranscript += `### Transcript\n\n`;
        formattedTranscript += transcript;
        
        return formattedTranscript;
      }

      return null;
    } catch (error) {
      this.error('Error parsing caption data:', error);
      return null;
    }
  }

  /**
   * Get caption track information
   */
  getCaptionTrackInfo(track) {
    return {
      language: track.name?.simpleText || track.languageCode || 'Unknown',
      type: track.vssId?.includes('a.') ? 'Auto-generated' : 'Manual',
      languageCode: track.languageCode
    };
  }

  /**
   * Format timestamp from milliseconds
   */
  formatTimestamp(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Get video title from page
   */
  getVideoTitle() {
    const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer') || 
                        document.querySelector('meta[name="title"]');
    
    if (titleElement) {
      return titleElement.textContent || titleElement.content || 'Unknown Video';
    }
    
    return document.title.replace(' - YouTube', '') || 'Unknown Video';
  }

  /**
   * Fallback: try to get captions from page HTML (less reliable)
   */
  async getCaptionsFromPageHTML() {
    // This is a fallback method - implementation would depend on YouTube's current structure
    this.log('Attempting fallback caption extraction from page HTML');
    
    // Look for any caption-related data in the page
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      if (script.textContent?.includes('captionTracks')) {
        try {
          // Try to extract caption data from script content
          const match = script.textContent.match(/captionTracks.*?\[.*?\]/);
          if (match) {
            this.log('Found potential caption data in script tag');
            // Would need to parse this data similarly to the main method
          }
        } catch (error) {
          // Continue to next script
        }
      }
    }
    
    return null;
  }

  /**
   * Handle plugin activation
   */
  onActivate() {
    this.log('Plugin activated');
    super.onActivate();
    
    // Set up observer for YouTube navigation (SPA routing)
    this.setupNavigationObserver();
    
    // Extract captions for current video if on video page
    if (this.shouldRunOnCurrentPage()) {
      this.log('Plugin should run on current page, extracting captions...');
      this.extractCaptions();
    } else {
      this.log('Plugin should NOT run on current page');
      this.log('Current URL:', window.location.href);
      this.log('Current hostname:', window.location.hostname);
      this.log('Current pathname:', window.location.pathname);
      this.log('Current search:', window.location.search);
    }
  }

  /**
   * Set up observer for YouTube's SPA navigation
   */
  setupNavigationObserver() {
    // YouTube uses pushState for navigation, so we need to listen for that
    const originalPushState = history.pushState;
    const self = this;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(() => self.onPageChange(), 100);
    };

    // Also listen for popstate
    window.addEventListener('popstate', () => {
      setTimeout(() => self.onPageChange(), 100);
    });
  }

  /**
   * Handle plugin deactivation
   */
  onDeactivate() {
    super.onDeactivate();
    this.captionsCache = null;
    this.currentVideoId = null;
  }
}

// Make plugin available globally
window.YoutubeCaptionsPlugin = YoutubeCaptionsPlugin;
console.log('YoutubeCaptionsPlugin: Class registered globally');