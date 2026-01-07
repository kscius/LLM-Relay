/**
 * Memory Service
 * 
 * Manages conversation memory including:
 * - Automatic summarization of old messages
 * - Key fact extraction
 * - Context building with memory + recent messages
 * - Global facts integration
 */

import { conversationMemoryRepo, messageRepo, settingsRepo } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';
import { providerRepo } from '../database/repositories/index.js';
import { contextWindowService, type ChatMessage } from './context-window.service.js';
import { factsService } from './facts.service.js';

// Configuration
const SUMMARIZATION_THRESHOLD = 10;  // Summarize when this many new messages since last summary
const SUMMARY_PROMPT = `You are a helpful assistant that summarizes conversations. 
Summarize the following conversation in 2-3 concise paragraphs, capturing:
1. The main topics discussed
2. Any important decisions or conclusions
3. Key information the user shared about themselves or their needs

Be concise but comprehensive. Write in third person (e.g., "The user asked about...", "The assistant explained...").`;

const FACTS_PROMPT = `Extract key facts from this conversation that would be useful to remember for future interactions.
Return a JSON array of short fact strings. Focus on:
- User preferences (programming languages, tools, styles)
- User's name or personal details if shared
- Project or work context
- Important requirements or constraints

Return ONLY a valid JSON array, nothing else. Example: ["user prefers TypeScript", "working on a React app", "name is John"]`;

class MemoryService {
  /**
   * Build context for a conversation including memory and global facts
   * Returns: [System prompt with memory + facts] + [Recent messages]
   */
  async buildContext(
    conversationId: string,
    messages: ChatMessage[]
  ): Promise<ChatMessage[]> {
    // Get custom system prompt from settings
    const settings = settingsRepo.getAll();
    const customSystemPrompt = settings.systemPrompt?.trim() || '';
    
    // Get conversation memory
    const memory = conversationMemoryRepo.get(conversationId);
    
    // Get global facts context
    const factsContext = factsService.buildFactsContext(conversationId);
    
    // Apply sliding window to get recent messages
    const recentMessages = contextWindowService.applyWindow(messages);
    
    // Check if we have any context to add
    const hasMemory = memory?.summary || (memory?.keyFacts && memory.keyFacts.length > 0);
    const hasFacts = factsContext.length > 0;
    const hasCustomPrompt = customSystemPrompt.length > 0;
    
    if (!hasMemory && !hasFacts && !hasCustomPrompt) {
      return recentMessages;
    }

    // Build combined context
    const contextParts: string[] = [];
    
    // Add custom system prompt first (user's primary instruction)
    if (hasCustomPrompt) {
      contextParts.push(customSystemPrompt);
    }
    
    // Add global facts (most important context)
    if (hasFacts) {
      contextParts.push(factsContext);
    }
    
    // Add conversation-specific memory
    if (hasMemory) {
      const memoryContext = this.buildMemoryPrompt(memory!.summary, memory!.keyFacts);
      contextParts.push(memoryContext);
    }
    
    const fullContext = contextParts.join('\n\n');
    
    // Separate existing system messages
    const systemMessages = recentMessages.filter(m => m.role === 'system');
    const conversationMessages = recentMessages.filter(m => m.role !== 'system');

    // Create enhanced system message with memory
    const enhancedSystemMessage: ChatMessage = {
      role: 'system',
      content: systemMessages.length > 0
        ? `${systemMessages.map(m => m.content).join('\n')}\n\n${fullContext}`
        : fullContext,
    };

    const factCount = factsService.getContextFacts(conversationId).length;
    console.log(`[Memory] Added context: custom prompt: ${hasCustomPrompt}, ${factCount} global facts, summary: ${!!memory?.summary}`);

    return [enhancedSystemMessage, ...conversationMessages];
  }

  /**
   * Build memory prompt from summary and facts
   */
  private buildMemoryPrompt(summary: string | null, keyFacts: string[]): string {
    const parts: string[] = [];

    if (summary) {
      parts.push(`## Previous Conversation Summary\n${summary}`);
    }

    if (keyFacts && keyFacts.length > 0) {
      parts.push(`## Key Facts About This User\n${keyFacts.map(f => `- ${f}`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Check if conversation needs summarization and do it
   */
  async maybeSummarize(conversationId: string): Promise<boolean> {
    // Get current message count
    const messages = messageRepo.listByConversation(conversationId);
    const messageCount = messages.length;

    // Check if we need to summarize
    if (!conversationMemoryRepo.needsSummary(conversationId, messageCount, SUMMARIZATION_THRESHOLD)) {
      return false;
    }

    // Get a provider with API key for summarization
    const provider = this.getAvailableProvider();
    if (!provider) {
      console.log('[Memory] No provider available for summarization');
      return false;
    }

    console.log(`[Memory] Summarizing conversation ${conversationId} (${messageCount} messages)`);

    try {
      // Get memory to find where we last summarized
      const memory = conversationMemoryRepo.get(conversationId);
      const lastSummarizedIdx = memory?.lastSummarizedMessageId
        ? messages.findIndex(m => m.id === memory.lastSummarizedMessageId)
        : -1;

      // Get messages to summarize (from last summary to current window start)
      const windowSize = contextWindowService.getMaxMessages();
      const windowStartIdx = Math.max(0, messages.length - windowSize);
      const messagesToSummarize = messages.slice(lastSummarizedIdx + 1, windowStartIdx);

      if (messagesToSummarize.length < 5) {
        // Not enough new messages to summarize
        return false;
      }

      // Generate summary
      const summary = await this.generateSummary(provider, messagesToSummarize, memory?.summary);
      
      if (summary) {
        // Get the last message ID we summarized
        const lastMessageId = messagesToSummarize[messagesToSummarize.length - 1].id;
        
        conversationMemoryRepo.updateSummary(
          conversationId,
          summary,
          messageCount,
          lastMessageId
        );

        console.log('[Memory] Summary updated successfully');

        // Also try to extract key facts
        await this.extractAndSaveKeyFacts(provider, conversationId, messagesToSummarize);

        return true;
      }
    } catch (error) {
      console.error('[Memory] Summarization failed:', error);
    }

    return false;
  }

  /**
   * Generate a summary of messages
   */
  private async generateSummary(
    provider: { id: ProviderId; apiKey: string },
    messages: Array<{ role: string; content: string }>,
    previousSummary?: string | null
  ): Promise<string | null> {
    const adapter = providerRegistry.get(provider.id);
    if (!adapter) return null;

    // Build the conversation text
    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const prompt = previousSummary
      ? `${SUMMARY_PROMPT}\n\n## Previous Summary:\n${previousSummary}\n\n## New Messages to Incorporate:\n${conversationText}`
      : `${SUMMARY_PROMPT}\n\n## Conversation:\n${conversationText}`;

    try {
      const generator = adapter.generate(
        { messages: [{ role: 'user', content: prompt }] },
        provider.apiKey
      );

      let result = '';
      for await (const chunk of generator) {
        if (chunk.type === 'delta' && chunk.delta) {
          result += chunk.delta;
        }
      }

      return result.trim();
    } catch (error) {
      console.error('[Memory] Summary generation error:', error);
      return null;
    }
  }

  /**
   * Extract key facts from messages
   */
  private async extractAndSaveKeyFacts(
    provider: { id: ProviderId; apiKey: string },
    conversationId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<void> {
    const adapter = providerRegistry.get(provider.id);
    if (!adapter) return;

    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const prompt = `${FACTS_PROMPT}\n\n## Conversation:\n${conversationText}`;

    try {
      const generator = adapter.generate(
        { messages: [{ role: 'user', content: prompt }] },
        provider.apiKey
      );

      let result = '';
      for await (const chunk of generator) {
        if (chunk.type === 'delta' && chunk.delta) {
          result += chunk.delta;
        }
      }

      // Try to parse as JSON
      const cleaned = result.trim();
      // Find JSON array in the response
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        const facts = JSON.parse(match[0]) as string[];
        if (Array.isArray(facts) && facts.length > 0) {
          conversationMemoryRepo.addKeyFacts(conversationId, facts);
          console.log(`[Memory] Extracted ${facts.length} key facts`);
        }
      }
    } catch (error) {
      console.error('[Memory] Fact extraction error:', error);
    }
  }

  /**
   * Get an available provider for summarization
   */
  private getAvailableProvider(): { id: ProviderId; apiKey: string } | null {
    // Prefer fast/cheap providers for summarization
    const preferredOrder: ProviderId[] = ['groq', 'cerebras', 'mistral', 'cohere', 'google', 'nvidia'];

    for (const id of preferredOrder) {
      const apiKey = providerRepo.getKey(id);
      if (apiKey) {
        return { id, apiKey };
      }
    }

    return null;
  }

  /**
   * Manually trigger summarization for a conversation
   */
  async forceSummarize(conversationId: string): Promise<boolean> {
    const provider = this.getAvailableProvider();
    if (!provider) {
      console.log('[Memory] No provider available for summarization');
      return false;
    }

    const messages = messageRepo.listByConversation(conversationId);
    if (messages.length < 5) {
      console.log('[Memory] Not enough messages to summarize');
      return false;
    }

    const summary = await this.generateSummary(provider, messages);
    if (summary) {
      const lastMessageId = messages[messages.length - 1].id;
      conversationMemoryRepo.updateSummary(conversationId, summary, messages.length, lastMessageId);
      await this.extractAndSaveKeyFacts(provider, conversationId, messages);
      return true;
    }

    return false;
  }

  /**
   * Get memory for a conversation
   */
  getMemory(conversationId: string) {
    return conversationMemoryRepo.get(conversationId);
  }

  /**
   * Add a key fact manually
   */
  addKeyFact(conversationId: string, fact: string): void {
    conversationMemoryRepo.addKeyFacts(conversationId, [fact]);
  }

  /**
   * Remove a key fact
   */
  removeKeyFact(conversationId: string, fact: string): void {
    conversationMemoryRepo.removeKeyFact(conversationId, fact);
  }

  /**
   * Clear memory for a conversation
   */
  clearMemory(conversationId: string): void {
    conversationMemoryRepo.delete(conversationId);
  }
}

export const memoryService = new MemoryService();

