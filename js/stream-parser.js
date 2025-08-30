// Stream Parser - Handle streaming responses and special blocks (reasoning, thinking)
class StreamParser {
  constructor() {
    this.buffer = '';
    this.currentChunk = '';
    this.isInSpecialBlock = false;
    this.currentBlockType = null;
    this.blockContent = '';
    
    // Block patterns for different LLM types
    this.blockPatterns = {
      reasoning: {
        start: /<reasoning[^>]*>/gi,
        end: /<\/reasoning>/gi,
        type: 'reasoning'
      },
      thinking: {
        start: /<thinking[^>]*>/gi,
        end: /<\/thinking>/gi,
        type: 'thinking'
      },
      // Some models use different formats
      thought: {
        start: /<thought[^>]*>/gi,
        end: /<\/thought>/gi,
        type: 'thinking'
      },
      reflection: {
        start: /<reflection[^>]*>/gi,
        end: /<\/reflection>/gi,
        type: 'reasoning'
      }
    };
  }

  // Parse OpenAI-style SSE chunk
  parseSSEChunk(chunk) {
    const lines = chunk.split('\n');
    const results = [];

    for (let line of lines) {
      line = line.trim();
      
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        
        if (data === '[DONE]') {
          results.push({ type: 'done' });
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          
          if (parsed.choices && parsed.choices[0]) {
            const choice = parsed.choices[0];
            
            if (choice.delta && choice.delta.content) {
              const processedContent = this.processContent(choice.delta.content);
              if (processedContent) {
                results.push({
                  type: 'content',
                  content: processedContent.content,
                  blocks: processedContent.blocks,
                  metadata: {
                    model: parsed.model,
                    finish_reason: choice.finish_reason,
                    index: choice.index
                  }
                });
              }
            }

            if (choice.finish_reason) {
              results.push({
                type: 'finish',
                reason: choice.finish_reason
              });
            }
          }
        } catch (error) {
          console.warn('StreamParser: Failed to parse SSE data:', error, data);
        }
      }
    }

    return results;
  }

  // Process content and extract special blocks
  processContent(content) {
    this.buffer += content;
    
    const result = {
      content: '',
      blocks: []
    };

    let processedBuffer = this.buffer;
    
    // Check for block patterns
    for (const [blockName, pattern] of Object.entries(this.blockPatterns)) {
      processedBuffer = this.extractBlocks(processedBuffer, pattern, result.blocks);
    }

    // What remains is regular content
    result.content = processedBuffer;
    
    // Update buffer to keep incomplete blocks
    this.buffer = this.findIncompleteBlocks(this.buffer);
    
    return result;
  }

  // Extract special blocks from content
  extractBlocks(content, pattern, blocks) {
    let remainingContent = content;
    let match;
    
    // Find start tags
    pattern.start.lastIndex = 0; // Reset regex
    while ((match = pattern.start.exec(content)) !== null) {
      const startPos = match.index;
      const startTag = match[0];
      
      // Find corresponding end tag
      pattern.end.lastIndex = pattern.start.lastIndex;
      const endMatch = pattern.end.exec(content);
      
      if (endMatch) {
        const endPos = endMatch.index + endMatch[0].length;
        const blockContent = content.slice(startPos + startTag.length, endMatch.index);
        
        blocks.push({
          type: pattern.type,
          content: blockContent.trim(),
          startPos,
          endPos,
          raw: content.slice(startPos, endPos)
        });
        
        // Remove the block from remaining content
        remainingContent = remainingContent.replace(content.slice(startPos, endPos), '');
      }
    }
    
    return remainingContent;
  }

  // Find incomplete blocks that should remain in buffer
  findIncompleteBlocks(content) {
    for (const pattern of Object.values(this.blockPatterns)) {
      pattern.start.lastIndex = 0;
      const startMatch = pattern.start.exec(content);
      
      if (startMatch) {
        pattern.end.lastIndex = pattern.start.lastIndex;
        const endMatch = pattern.end.exec(content);
        
        // If we found a start but no end, keep the incomplete block
        if (!endMatch) {
          return content.slice(startMatch.index);
        }
      }
    }
    
    return '';
  }

  // Parse complete response (non-streaming)
  parseCompleteResponse(response) {
    const result = this.processContent(response);
    
    // For complete responses, we can finalize everything
    this.buffer = '';
    
    return {
      type: 'complete',
      content: result.content,
      blocks: result.blocks
    };
  }

  // Reset parser state
  reset() {
    this.buffer = '';
    this.currentChunk = '';
    this.isInSpecialBlock = false;
    this.currentBlockType = null;
    this.blockContent = '';
  }

  // Get current buffer state (for debugging)
  getState() {
    return {
      buffer: this.buffer,
      isInSpecialBlock: this.isInSpecialBlock,
      currentBlockType: this.currentBlockType,
      blockContent: this.blockContent
    };
  }

  // Handle different streaming formats
  parseChunk(chunk, format = 'openai-sse') {
    switch (format) {
      case 'openai-sse':
        return this.parseSSEChunk(chunk);
      case 'anthropic-sse':
        return this.parseAnthropicSSE(chunk);
      case 'raw':
        return this.parseRawChunk(chunk);
      default:
        console.warn('StreamParser: Unknown format:', format);
        return [];
    }
  }

  // Parse Anthropic-style streaming (for future implementation)
  parseAnthropicSSE(chunk) {
    // TODO: Implement Anthropic streaming format
    const lines = chunk.split('\n');
    const results = [];
    
    for (let line of lines) {
      line = line.trim();
      
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.type === 'content_block_delta') {
            const processedContent = this.processContent(parsed.delta.text || '');
            if (processedContent) {
              results.push({
                type: 'content',
                content: processedContent.content,
                blocks: processedContent.blocks,
                metadata: {
                  type: parsed.type,
                  index: parsed.index
                }
              });
            }
          }
        } catch (error) {
          console.warn('StreamParser: Failed to parse Anthropic SSE:', error);
        }
      }
    }
    
    return results;
  }

  // Parse raw text chunks
  parseRawChunk(chunk) {
    const processedContent = this.processContent(chunk);
    return [{
      type: 'content',
      content: processedContent.content,
      blocks: processedContent.blocks
    }];
  }

  // Utility to format blocks for display
  formatBlockForDisplay(block, showBlocks = true) {
    if (!showBlocks && (block.type === 'thinking' || block.type === 'reasoning')) {
      return '';
    }

    const emoji = {
      'thinking': '🤔',
      'reasoning': '🧠',
      'reflection': '💭'
    }[block.type] || '💡';

    return `\n\n${emoji} **${block.type.charAt(0).toUpperCase() + block.type.slice(1)}:**\n${block.content}\n`;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StreamParser;
} else if (typeof globalThis !== 'undefined') {
  globalThis.StreamParser = StreamParser;
} else if (typeof self !== 'undefined') {
  self.StreamParser = StreamParser;
}