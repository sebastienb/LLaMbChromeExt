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
   * Extract captions from YouTube video using multiple approaches
   */
  async extractCaptions() {
    return this.safeAsyncOperation(async () => {
      const videoId = this.getCurrentVideoId();
      if (!videoId) {
        this.warn('No video ID found');
        return null;
      }

      this.log('Extracting captions for video:', videoId);

      // Try multiple extraction methods in order of preference
      const extractionMethods = [
        () => this.getCaptionsFromBackgroundScript(videoId),
        () => this.getCaptionsFromPlayerResponse(),
        () => this.getCaptionsFromPageHTML(),
        () => this.getCaptionsFromDirectAPI(videoId),
        () => this.getCaptionsFromVideoInfo(videoId)
      ];

      let captions = null;
      for (const method of extractionMethods) {
        try {
          captions = await method();
          if (captions) {
            this.log('Successfully extracted captions using method:', method.name);
            break;
          }
        } catch (error) {
          this.log('Method failed:', method.name, error.message);
        }
      }

      if (captions) {
        const videoTitle = this.getVideoTitle();
        
        // Debug: Log what we got from caption extraction
        this.log('Captions extracted, type:', typeof captions);
        this.log('Captions content:', captions);
        
        // Ensure captions is a string
        let captionText = captions;
        if (typeof captions === 'object') {
          this.warn('Captions is an object, attempting to stringify:', captions);
          try {
            captionText = JSON.stringify(captions, null, 2);
          } catch (e) {
            captionText = '[Unable to stringify captions object]';
          }
        }
        
        // Format captions with clear labeling
        const formattedCaptions = `## YouTube Video Captions\n\n**Video Title:** ${videoTitle}\n**Video ID:** ${videoId}\n\n${captionText}`;
        
        this.captionsCache = this.formatContentForChat(formattedCaptions, {
          title: `YouTube Video Captions`,
          type: 'captions',
          includeMetadata: false // We're adding our own metadata
        });
        
        // Debug: Log what formatContentForChat returned
        this.log('formatContentForChat returned type:', typeof this.captionsCache);
        this.log('formatContentForChat content:', this.captionsCache);
        
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
   * Method 1: Try to get captions using background script to bypass CORS
   */
  async getCaptionsFromBackgroundScript(videoId) {
    this.log('=== BACKGROUND SCRIPT METHOD STARTING ===');
    this.log('Trying background script method for video:', videoId);
    
    // First test if background script is responding at all
    this.log('Testing background script connectivity...');
    try {
      const testResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'getCurrentTab'  // This should work
        }, (response) => {
          resolve(response);
        });
      });
      this.log('Background script connectivity test result:', testResult);
    } catch (error) {
      this.error('Background script connectivity test failed:', error);
      return null;
    }
    
    try {
      // First, get caption tracks from page HTML
      const captionTracks = await this.getCaptionTracksFromPage();
      if (!captionTracks || captionTracks.length === 0) {
        this.log('No caption tracks found in page');
        return null;
      }
      
      this.log('Found caption tracks for background fetch:', captionTracks.length);
      
      // Sort tracks by preference
      const sortedTracks = this.sortCaptionTracks(captionTracks);
      
      // Try to fetch captions from the best track using background script
      for (const track of sortedTracks) {
        if (track && track.baseUrl) {
          const captionUrl = track.baseUrl + '&fmt=json3';
          this.log('Requesting background script to fetch:', captionUrl);
          
          try {
            const messageData = {
              action: 'fetchYoutubeCaptions',
              captionUrl: captionUrl
            };
            
            this.log('Sending message to background script:', messageData);
            
            // Test with a known working action first
            this.log('Testing with getCurrentTab first...');
            const testResult = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'getCurrentTab'
              }, (response) => {
                resolve(response);
              });
            });
            this.log('getCurrentTab test result:', testResult);
            
            const result = await new Promise((resolve) => {
              chrome.runtime.sendMessage(messageData, (response) => {
                resolve(response);
              });
            });
            
            this.log('Background script response:', result);
            
            if (result && result.success && result.data) {
              const captions = this.parseCaptionData(result.data, track);
              if (captions) {
                this.log('Successfully extracted captions via background script, length:', captions.length);
                return captions;
              }
            } else {
              this.warn('Background script failed:', result?.error || 'Unknown error');
            }
          } catch (error) {
            this.error('Background script request failed:', error);
          }
        }
      }
      
      return null;
    } catch (error) {
      this.error('Background script method failed:', error);
      return null;
    }
  }

  /**
   * Helper method to extract caption tracks from page HTML
   */
  async getCaptionTracksFromPage() {
    try {
      // Look for caption tracks in page scripts
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const content = script.textContent || '';
        
        if (content.includes('captionTracks')) {
          // Try multiple patterns to extract caption tracks
          const patterns = [
            /"captionTracks":\s*(\[.*?\])/,
            /"captionTracks":\s*(\[[\s\S]*?\](?=\s*[,}]))/
          ];
          
          for (const pattern of patterns) {
            try {
              const match = content.match(pattern);
              if (match) {
                const captionTracks = JSON.parse(match[1]);
                
                if (Array.isArray(captionTracks) && captionTracks.length > 0) {
                  // Validate that these look like real caption tracks
                  const validTrack = captionTracks.find(track => 
                    track && track.baseUrl && (track.languageCode || track.name)
                  );
                  
                  if (validTrack) {
                    this.log('Extracted caption tracks from page HTML:', captionTracks.length);
                    return captionTracks;
                  }
                }
              }
            } catch (parseError) {
              // Continue to next pattern
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      this.error('Error extracting caption tracks from page:', error);
      return null;
    }
  }

  /**
   * Method 2: Try to get captions by injecting script into page context
   * This bypasses CORS restrictions by running within YouTube's own domain
   */
  async getCaptionsFromDOMInjection(videoId) {
    this.log('=== DOM INJECTION METHOD STARTING ===');
    this.log('Trying DOM injection method for video:', videoId);
    
    return new Promise((resolve) => {
      // Create a unique callback name
      const callbackName = `llamb_caption_callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set up callback to receive data from injected script
      window[callbackName] = (result) => {
        this.log('DOM injection callback received:', result);
        delete window[callbackName]; // Clean up
        
        if (result && result.success && result.transcript) {
          resolve(result.transcript);
        } else {
          this.log('DOM injection failed:', result?.error || 'No transcript data');
          resolve(null);
        }
      };
      
      // Inject script into page context
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          const callbackName = '${callbackName}';
          const videoId = '${videoId}';
          
          function processCaptionTracks(captionTracks, source) {
            console.log('[Llamb Caption Extractor] Processing caption tracks from:', source, 'count:', captionTracks.length);
            
            // Sort tracks by preference (English first, manual captions preferred)
            const sortedTracks = captionTracks
              .filter(track => !track.vssId.includes('a.') || true) // Include all for now
              .sort((a, b) => {
                const aLang = a.languageCode || '';
                const bLang = b.languageCode || '';
                
                // Prefer English
                if (aLang === 'en' && bLang !== 'en') return -1;
                if (bLang === 'en' && aLang !== 'en') return 1;
                
                // Prefer manual captions
                const aAuto = a.vssId?.includes('a.');
                const bAuto = b.vssId?.includes('a.');
                if (!aAuto && bAuto) return -1;
                if (!bAuto && aAuto) return 1;
                
                return 0;
              });
            
            // Try to fetch captions from the best track
            const track = sortedTracks[0];
            if (track && track.baseUrl) {
              const captionUrl = track.baseUrl + '&fmt=json3';
              console.log('[Llamb Caption Extractor] Fetching from:', captionUrl);
              
              fetch(captionUrl)
                .then(response => {
                  console.log('[Llamb Caption Extractor] Fetch response status:', response.status);
                  if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                  }
                  return response.text();
                })
                .then(text => {
                  console.log('[Llamb Caption Extractor] Response text length:', text.length);
                  if (!text.trim()) {
                    throw new Error('Empty response');
                  }
                  
                  const captionData = JSON.parse(text);
                  console.log('[Llamb Caption Extractor] Parsed caption data, events:', captionData.events?.length);
                  
                  if (captionData.events) {
                    let transcript = '';
                    const textEvents = captionData.events.filter(event => event.segs);
                    
                    for (const event of textEvents) {
                      const text = event.segs.map(seg => seg.utf8 || '').join('');
                      if (text.trim()) {
                        transcript += text.trim() + ' ';
                      }
                    }
                    
                    transcript = transcript.replace(/\\s+/g, ' ').trim();
                    
                    if (transcript) {
                      const captionInfo = {
                        language: track.name?.simpleText || track.languageCode || 'Unknown',
                        type: track.vssId?.includes('a.') ? 'Auto-generated' : 'Manual'
                      };
                      
                      let formattedTranscript = '### Caption Details\\n';
                      formattedTranscript += '- **Language:** ' + captionInfo.language + '\\n';
                      formattedTranscript += '- **Type:** ' + captionInfo.type + '\\n\\n';
                      formattedTranscript += '### Transcript\\n\\n';
                      formattedTranscript += transcript;
                      
                      console.log('[Llamb Caption Extractor] Successfully extracted transcript, length:', transcript.length);
                      window[callbackName]({ success: true, transcript: formattedTranscript });
                      return;
                    }
                  }
                  
                  throw new Error('No usable caption data found');
                })
                .catch(error => {
                  console.error('[Llamb Caption Extractor] Fetch error:', error);
                  window[callbackName]({ success: false, error: error.message });
                });
              
              // Don't resolve immediately, wait for fetch
              return true; // Indicate that we're processing
            }
            
            return false; // No suitable tracks found
          }
          
          try {
            console.log('[Llamb Caption Extractor] Starting DOM injection extraction for:', videoId);
            
            // Method 1: Try to access ytInitialPlayerResponse global
            if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse) {
              console.log('[Llamb Caption Extractor] Found ytInitialPlayerResponse global');
              const captionTracks = ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
              
              if (captionTracks && captionTracks.length > 0) {
                if (processCaptionTracks(captionTracks, 'ytInitialPlayerResponse global')) {
                  return; // Processing async, will callback when done
                }
              }
            }
            
            // Method 2: Search all scripts for caption track data
            console.log('[Llamb Caption Extractor] Searching scripts for caption tracks');
            const scripts = document.querySelectorAll('script');
            let foundTracks = false;
            
            for (const script of scripts) {
              const content = script.textContent || script.innerText || '';
              
              if (content.includes('captionTracks')) {
                console.log('[Llamb Caption Extractor] Found script with captionTracks, length:', content.length);
                
                // Try multiple patterns to extract caption tracks
                const patterns = [
                  /"captionTracks"\\s*:\\s*(\\[[^\\]]*\\])/g,
                  /"captionTracks"\\s*:\\s*(\\[[\\s\\S]*?\\](?=\\s*[,}]))/g,
                  /captionTracks[^\\[]*?(\\[\\s*\\{[\\s\\S]*?\\}\\s*\\])/g
                ];
                
                for (const pattern of patterns) {
                  let match;
                  pattern.lastIndex = 0; // Reset regex
                  
                  while ((match = pattern.exec(content)) !== null) {
                    try {
                      console.log('[Llamb Caption Extractor] Trying to parse match:', match[1].substring(0, 200));
                      const captionTracks = JSON.parse(match[1]);
                      
                      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
                        console.log('[Llamb Caption Extractor] Successfully parsed caption tracks:', captionTracks.length);
                        
                        // Validate that these look like real caption tracks
                        const validTrack = captionTracks.find(track => 
                          track && track.baseUrl && (track.languageCode || track.name)
                        );
                        
                        if (validTrack) {
                          if (processCaptionTracks(captionTracks, 'script parsing')) {
                            foundTracks = true;
                            return; // Processing async, will callback when done
                          }
                        } else {
                          console.log('[Llamb Caption Extractor] Parsed tracks but no valid tracks found');
                        }
                      }
                    } catch (parseError) {
                      console.log('[Llamb Caption Extractor] Failed to parse caption tracks:', parseError.message);
                      // Continue to next match
                    }
                    
                    // Prevent infinite loops
                    if (pattern.global && pattern.lastIndex === match.index) {
                      break;
                    }
                  }
                  
                  if (foundTracks) break;
                }
                
                if (foundTracks) break;
              }
            }
            
            if (foundTracks) {
              return; // Processing async
            }
            
            // Method 3: Try to find player API and get captions through it
            if (typeof yt !== 'undefined' && yt.player) {
              console.log('[Llamb Caption Extractor] Found yt.player, trying to access captions');
              // Try to access player instance
              const players = document.querySelectorAll('[id*="player"]');
              for (const playerEl of players) {
                try {
                  if (playerEl.getPlayerResponse) {
                    const playerResponse = playerEl.getPlayerResponse();
                    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (captionTracks && captionTracks.length > 0) {
                      console.log('[Llamb Caption Extractor] Found captions via player API');
                      if (processCaptionTracks(captionTracks, 'player API')) {
                        return; // Processing async
                      }
                    }
                  }
                } catch (e) {
                  console.log('[Llamb Caption Extractor] Player access failed:', e.message);
                }
              }
            }
            
            // If all methods fail
            console.log('[Llamb Caption Extractor] No captions found via DOM injection');
            window[callbackName]({ success: false, error: 'No captions accessible via DOM injection' });
            
          } catch (error) {
            console.error('[Llamb Caption Extractor] DOM injection error:', error);
            window[callbackName]({ success: false, error: error.message });
          }
        })();
      `;
      
      // Inject and clean up
      document.head.appendChild(script);
      document.head.removeChild(script);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (window[callbackName]) {
          this.log('DOM injection timed out');
          delete window[callbackName];
          resolve(null);
        }
      }, 10000);
    });
  }

  /**
   * Method 2: Try to get captions using YouTube's direct transcript API
   * Similar to how python youtube-transcript-api works
   */
  async getCaptionsFromDirectAPI(videoId) {
    this.log('Trying direct YouTube transcript API for video:', videoId);
    
    try {
      // Try to get the video page to extract transcript data
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      
      // Look for transcript data in the page
      const transcriptRegex = /"captionTracks":\s*(\[.*?\])/;
      const match = html.match(transcriptRegex);
      
      if (!match) {
        this.log('No transcript data found in direct API response');
        return null;
      }
      
      const captionTracks = JSON.parse(match[1]);
      this.log('Found caption tracks via direct API:', captionTracks.length);
      
      if (captionTracks && captionTracks.length > 0) {
        const sortedTracks = this.sortCaptionTracks(captionTracks);
        
        for (const track of sortedTracks) {
          const captions = await this.fetchCaptionsFromTrack(track);
          if (captions) {
            return captions;
          }
        }
      }
      
      return null;
    } catch (error) {
      this.error('Direct API extraction failed:', error);
      return null;
    }
  }

  /**
   * Method 4: Try to extract captions from YouTube's video info endpoint
   * Alternative approach when player response isn't available
   */
  async getCaptionsFromVideoInfo(videoId) {
    this.log('Trying video info endpoint for video:', videoId);
    
    try {
      // Try the get_video_info endpoint
      const infoUrl = `https://www.youtube.com/get_video_info?video_id=${videoId}&el=embedded&ps=default&eurl=&gl=US&hl=en`;
      const response = await fetch(infoUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.text();
      const params = new URLSearchParams(data);
      
      // Look for player response in the video info
      const playerResponseStr = params.get('player_response');
      if (!playerResponseStr) {
        this.log('No player_response in video info');
        return null;
      }
      
      const playerResponse = JSON.parse(playerResponseStr);
      const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      
      if (captionTracks && captionTracks.length > 0) {
        this.log('Found caption tracks via video info:', captionTracks.length);
        const sortedTracks = this.sortCaptionTracks(captionTracks);
        
        for (const track of sortedTracks) {
          const captions = await this.fetchCaptionsFromTrack(track);
          if (captions) {
            return captions;
          }
        }
      }
      
      return null;
    } catch (error) {
      this.error('Video info extraction failed:', error);
      return null;
    }
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
        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (!captionTracks || captionTracks.length === 0) {
          this.log('No caption tracks found in fetched player response');
          return null;
        }

        this.log('Found caption tracks in fetched response:', captionTracks.length);

        // Sort tracks by preference and fetch captions
        const sortedTracks = this.sortCaptionTracks(captionTracks);
        
        // Try to fetch captions from the best track
        for (const track of sortedTracks) {
          const captions = await this.fetchCaptionsFromTrack(track);
          if (captions) {
            return captions;
          }
        }
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
      this.log('Caption fetch response status:', response.status);
      
      if (!response.ok) {
        this.warn('Failed to fetch captions, status:', response.status);
        this.warn('Response headers:', response.headers);
        const errorText = await response.text();
        this.warn('Error response body:', errorText);
        return null;
      }
      
      // Check what we actually got back
      const responseText = await response.text();
      this.log('Raw response text length:', responseText.length);
      this.log('Raw response sample:', responseText.substring(0, 200));
      
      if (!responseText.trim()) {
        this.warn('Empty response from caption API');
        return null;
      }
      
      let captionData;
      try {
        captionData = JSON.parse(responseText);
      } catch (parseError) {
        this.error('Failed to parse caption response as JSON:', parseError.message);
        this.log('Response was:', responseText);
        return null;
      }
      
      this.log('Caption data received:', captionData);
      this.log('Caption data type:', typeof captionData);
      this.log('Caption events:', captionData.events?.length || 'No events');
      
      const parsedCaptions = this.parseCaptionData(captionData, track);
      this.log('Parsed captions result:', typeof parsedCaptions, parsedCaptions?.substring(0, 100));
      
      return parsedCaptions;
    } catch (error) {
      this.error('Error fetching captions from track:', error);
      this.error('Error details:', error.message);
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
    this.log('Attempting fallback caption extraction from page HTML');
    
    // Look for any caption-related data in the page
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent || '';
      
      // Look for any mention of player response or caption data
      if (content.includes('ytInitialPlayerResponse') || content.includes('playerResponse') || content.includes('captionTracks')) {
        try {
          this.log('Found potentially relevant script, length:', content.length);
          
          // Try multiple patterns to extract caption tracks
          const patterns = [
            /"captionTracks":\s*(\[.*?\])/,
            /"captionTracks":\s*(\[[\s\S]*?\])/,
            /ytInitialPlayerResponse["\s]*[:=]\s*({.*?"captionTracks".*?})/,
            /playerResponse["\s]*[:=]\s*({.*?"captionTracks".*?})/
          ];
          
          for (const pattern of patterns) {
            try {
              const match = content.match(pattern);
              if (match) {
                this.log('Found match with pattern:', pattern.source);
                
                let captionTracks;
                if (match[1].startsWith('[')) {
                  // Direct caption tracks array
                  captionTracks = JSON.parse(match[1]);
                } else {
                  // Full player response object
                  const playerResponse = JSON.parse(match[1]);
                  captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                }
                
                this.log('Extracted caption tracks:', captionTracks);
                
                if (captionTracks && captionTracks.length > 0) {
                  // Sort tracks by preference and fetch captions
                  const sortedTracks = this.sortCaptionTracks(captionTracks);
                  
                  // Try to fetch captions from the best track
                  for (const track of sortedTracks) {
                    const captions = await this.fetchCaptionsFromTrack(track);
                    if (captions) {
                      return captions;
                    }
                  }
                }
              }
            } catch (parseError) {
              this.log('Failed to parse with pattern:', pattern.source, parseError.message);
              // Continue to next pattern
            }
          }
          
          // If no patterns worked, try a more aggressive approach
          if (content.includes('captionTracks')) {
            this.log('Trying aggressive caption track extraction');
            const aggressiveMatch = content.match(/captionTracks[^[]*(\[[\s\S]*?\])/);
            if (aggressiveMatch) {
              try {
                const tracks = JSON.parse(aggressiveMatch[1]);
                if (tracks && tracks.length > 0) {
                  this.log('Aggressively extracted tracks:', tracks);
                  const sortedTracks = this.sortCaptionTracks(tracks);
                  for (const track of sortedTracks) {
                    const captions = await this.fetchCaptionsFromTrack(track);
                    if (captions) {
                      return captions;
                    }
                  }
                }
              } catch (aggressiveError) {
                this.log('Aggressive extraction failed:', aggressiveError.message);
              }
            }
          }
        } catch (error) {
          this.error('Error processing script:', error);
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
   * Get detailed content for modal display with debugging information
   */
  async getDetailedContent() {
    let detailedContent = `# YouTube Captions Plugin\n\n`;
    
    // Plugin status
    detailedContent += `## Plugin Status\n\n`;
    detailedContent += `- **Active:** ${this.isActive ? 'Yes' : 'No'}\n`;
    detailedContent += `- **Should Run:** ${this.shouldRunOnCurrentPage() ? 'Yes' : 'No'}\n`;
    detailedContent += `- **Current URL:** ${window.location.href}\n`;
    detailedContent += `- **Video ID:** ${this.getCurrentVideoId() || 'Not detected'}\n`;
    detailedContent += `- **Cached Video ID:** ${this.currentVideoId || 'None'}\n\n`;
    
    // Detection details
    detailedContent += `## Detection Details\n\n`;
    const hostname = window.location.hostname;
    const isYouTube = hostname === 'youtube.com' || 
                     hostname === 'www.youtube.com' || 
                     hostname === 'm.youtube.com' ||
                     hostname.endsWith('.youtube.com');
    const isVideo = this.isVideoPage();
    
    detailedContent += `- **Domain:** ${hostname}\n`;
    detailedContent += `- **Is YouTube domain:** ${isYouTube ? 'Yes' : 'No'}\n`;
    detailedContent += `- **Is video page:** ${isVideo ? 'Yes' : 'No'}\n`;
    detailedContent += `- **Path:** ${window.location.pathname}\n`;
    detailedContent += `- **Search params:** ${window.location.search}\n\n`;
    
    // Caption status
    detailedContent += `## Caption Status\n\n`;
    if (this.captionsCache === null) {
      detailedContent += `- **Status:** Not attempted or in progress\n\n`;
    } else if (this.captionsCache === false) {
      detailedContent += `- **Status:** No captions found\n\n`;
    } else {
      detailedContent += `- **Status:** Captions extracted successfully\n`;
      detailedContent += `- **Content length:** ${this.captionsCache.length} characters\n\n`;
    }
    
    // Debug YouTube API access
    detailedContent += `## YouTube API Debug\n\n`;
    if (typeof window.ytInitialPlayerResponse !== 'undefined') {
      const playerResponse = window.ytInitialPlayerResponse;
      const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      
      if (captionTracks && captionTracks.length > 0) {
        detailedContent += `- **ytInitialPlayerResponse:** Available\n`;
        detailedContent += `- **Caption tracks found:** ${captionTracks.length}\n\n`;
        
        detailedContent += `### Available Caption Tracks:\n\n`;
        captionTracks.forEach((track, index) => {
          detailedContent += `**Track ${index + 1}:**\n`;
          detailedContent += `- Language: ${track.name?.simpleText || track.languageCode || 'Unknown'}\n`;
          detailedContent += `- Language Code: ${track.languageCode || 'Unknown'}\n`;
          detailedContent += `- VSS ID: ${track.vssId || 'Unknown'}\n`;
          detailedContent += `- Type: ${track.vssId?.includes('a.') ? 'Auto-generated' : 'Manual'}\n`;
          detailedContent += `- Base URL: ${track.baseUrl ? 'Available' : 'Not available'}\n\n`;
        });
      } else {
        detailedContent += `- **ytInitialPlayerResponse:** Available but no caption tracks found\n\n`;
      }
    } else {
      detailedContent += `- **ytInitialPlayerResponse:** Not available\n\n`;
    }
    
    // Settings
    detailedContent += `## Plugin Settings\n\n`;
    detailedContent += `- **Preferred Language:** ${this.getSetting('preferredLanguage', 'en')}\n`;
    detailedContent += `- **Include Timestamps:** ${this.getSetting('includeTimestamps', false) ? 'Yes' : 'No'}\n`;
    detailedContent += `- **Include Auto-Generated:** ${this.getSetting('includeAutoGenerated', true) ? 'Yes' : 'No'}\n\n`;
    
    // Add extracted content if available
    if (this.captionsCache && this.captionsCache !== false) {
      detailedContent += `## Extracted Content\n\n`;
      
      // Debug: Check what type of object we have
      detailedContent += `**Content Type:** ${typeof this.captionsCache}\n\n`;
      
      if (typeof this.captionsCache === 'string') {
        detailedContent += this.captionsCache;
      } else if (typeof this.captionsCache === 'object') {
        detailedContent += `**Object Structure:**\n\n`;
        detailedContent += '```json\n';
        try {
          detailedContent += JSON.stringify(this.captionsCache, null, 2);
        } catch (e) {
          detailedContent += 'Unable to stringify object: ' + e.message;
        }
        detailedContent += '\n```\n\n';
        
        // Try to extract meaningful content from the object
        if (this.captionsCache.content) {
          detailedContent += `**Extracted Content:**\n\n${this.captionsCache.content}\n\n`;
        }
        if (this.captionsCache.text) {
          detailedContent += `**Text Content:**\n\n${this.captionsCache.text}\n\n`;
        }
        if (this.captionsCache.data) {
          detailedContent += `**Data Content:**\n\n${this.captionsCache.data}\n\n`;
        }
        
        // Show all object properties
        detailedContent += `**Object Properties:**\n\n`;
        for (const [key, value] of Object.entries(this.captionsCache)) {
          detailedContent += `- **${key}:** ${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}\n`;
        }
      } else {
        detailedContent += `Unexpected content type: ${this.captionsCache}`;
      }
    } else if (this.shouldRunOnCurrentPage()) {
      detailedContent += `## Extraction Attempt\n\n`;
      detailedContent += `Attempting to extract captions now...\n\n`;
      
      // Try to extract captions for debugging with detailed logging
      try {
        const videoId = this.getCurrentVideoId();
        detailedContent += `**Video ID:** ${videoId}\n\n`;
        
        // Try all extraction methods in order
        detailedContent += `### Method 1: Background Script\n\n`;
        const backgroundCaptions = await this.getCaptionsFromBackgroundScript(videoId);
        detailedContent += `Background script result: ${backgroundCaptions ? 'Success' : 'Failed'}\n\n`;
        
        if (backgroundCaptions) {
          detailedContent += `**Background script captions:**\n\n${backgroundCaptions}\n\n`;
        } else {
          detailedContent += `### Method 2: Player Response\n\n`;
          const playerCaptions = await this.getCaptionsFromPlayerResponse();
          detailedContent += `Player response result: ${playerCaptions ? 'Success' : 'Failed'}\n\n`;
          
          if (playerCaptions) {
            detailedContent += `**Player response captions:**\n\n${playerCaptions}\n\n`;
          } else {
            detailedContent += `### Method 3: Page HTML\n\n`;
            const htmlCaptions = await this.getCaptionsFromPageHTML();
            detailedContent += `HTML fallback result: ${htmlCaptions ? 'Success' : 'Failed'}\n\n`;
            
            if (htmlCaptions) {
              detailedContent += `**HTML fallback captions:**\n\n${htmlCaptions}\n\n`;
            } else {
              detailedContent += `### Method 4: Direct API\n\n`;
              const directCaptions = await this.getCaptionsFromDirectAPI(videoId);
              detailedContent += `Direct API result: ${directCaptions ? 'Success' : 'Failed'}\n\n`;
              
              if (directCaptions) {
                detailedContent += `**Direct API captions:**\n\n${directCaptions}\n\n`;
              } else {
                detailedContent += `### Method 5: Video Info Endpoint\n\n`;
                const infoCaptions = await this.getCaptionsFromVideoInfo(videoId);
                detailedContent += `Video info result: ${infoCaptions ? 'Success' : 'Failed'}\n\n`;
                
                if (infoCaptions) {
                  detailedContent += `**Video info captions:**\n\n${infoCaptions}\n\n`;
                } else {
                  detailedContent += `**All methods failed** - No captions could be retrieved.\n\n`;
                  
                  // Additional debugging
                  detailedContent += `### Additional Debug Info\n\n`;
                  detailedContent += `- ytInitialPlayerResponse available: ${typeof window.ytInitialPlayerResponse !== 'undefined'}\n`;
                  
                  // Check for other YouTube data objects
                  detailedContent += `- ytInitialData available: ${typeof window.ytInitialData !== 'undefined'}\n`;
                  detailedContent += `- ytcfg available: ${typeof window.ytcfg !== 'undefined'}\n`;
                  detailedContent += `- yt available: ${typeof window.yt !== 'undefined'}\n`;
                  
                  // Check for any scripts with caption-related data
                  const scripts = document.querySelectorAll('script');
                  let foundCaptionScripts = 0;
                  let foundPlayerScripts = 0;
                  let foundYtInitialScripts = 0;
                  let captionTrackSamples = [];
                  
                  for (const script of scripts) {
                    const content = script.textContent || '';
                    if (content.includes('captionTracks')) {
                      foundCaptionScripts++;
                      
                      // Extract a sample of the captionTracks data
                      const captionMatch = content.match(/"captionTracks":\s*(\[[^\]]*\])/);
                      if (captionMatch) {
                        captionTrackSamples.push({
                          sample: captionMatch[1].substring(0, 500), // First 500 chars
                          length: captionMatch[1].length
                        });
                      }
                    }
                    if (content.includes('ytInitialPlayerResponse')) foundYtInitialScripts++;
                    if (content.includes('playerResponse')) foundPlayerScripts++;
                  }
                  
                  detailedContent += `- Scripts containing 'captionTracks': ${foundCaptionScripts}\n`;
                  detailedContent += `- Scripts containing 'ytInitialPlayerResponse': ${foundYtInitialScripts}\n`;
                  detailedContent += `- Scripts containing 'playerResponse': ${foundPlayerScripts}\n\n`;
                  
                  // Show caption track samples
                  if (captionTrackSamples.length > 0) {
                    detailedContent += `### Caption Track Data Found:\n\n`;
                    captionTrackSamples.forEach((sample, index) => {
                      detailedContent += `**Sample ${index + 1}** (${sample.length} chars total):\n`;
                      detailedContent += '```json\n';
                      detailedContent += sample.sample;
                      if (sample.length > 500) {
                        detailedContent += '\n... [truncated]';
                      }
                      detailedContent += '\n```\n\n';
                    });
                  }
                  
                  // Check for player elements
                  const playerElements = document.querySelectorAll('[id*="player"], [class*="player"]');
                  detailedContent += `- Player elements found: ${playerElements.length}\n`;
                  
                  // Try to find caption button or menu
                  const captionButtons = document.querySelectorAll('[aria-label*="ption"], [title*="ption"], [class*="caption"], [class*="subtitle"]');
                  detailedContent += `- Caption-related elements: ${captionButtons.length}\n`;
                  
                  // Check if video has captions by looking for CC button
                  const ccButton = document.querySelector('.ytp-subtitles-button, .ytp-cc-button');
                  detailedContent += `- CC button found: ${ccButton ? 'Yes' : 'No'}\n`;
                  if (ccButton) {
                    detailedContent += `- CC button classes: ${ccButton.className}\n`;
                    detailedContent += `- CC button aria-pressed: ${ccButton.getAttribute('aria-pressed')}\n`;
                  }
                  
                  // Try to access video element
                  const videoElement = document.querySelector('video');
                  if (videoElement) {
                    const tracks = videoElement.textTracks;
                    detailedContent += `- Video text tracks: ${tracks.length}\n`;
                    for (let i = 0; i < tracks.length; i++) {
                      const track = tracks[i];
                      detailedContent += `  - Track ${i}: ${track.kind} (${track.language}) - ${track.mode}\n`;
                    }
                  } else {
                    detailedContent += `- Video element: Not found\n`;
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        detailedContent += `**Fresh extraction error:** ${error.message}\n`;
        detailedContent += `**Error stack:** ${error.stack}\n`;
      }
    } else {
      detailedContent += `## Not Active\n\nThis plugin is not active on the current page.`;
    }
    
    return detailedContent;
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