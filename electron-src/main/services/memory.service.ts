// Conversation memory - summarization, facts, context building

import { conversationMemoryRepo, messageRepo, settingsRepo } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';
import { providerRepo } from '../database/repositories/index.js';
import { contextWindowService, type ChatMessage } from './context-window.service.js';
import { factsService } from './facts.service.js';

const SUMMARIZE_AFTER = 10;

const SUMMARY_PROMPT = `Summarize this conversation in 2-3 paragraphs. Capture main topics, decisions, and user info. Write in third person.`;

const FACTS_PROMPT = `Extract key facts from this conversation as a JSON array. Focus on user preferences, name, project context. Return ONLY a JSON array like: ["prefers TypeScript", "name is John"]`;

class MemoryService {
  async buildContext(convId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    const settings = settingsRepo.getAll();
    const sysPrompt = settings.systemPrompt?.trim() || '';
    const memory = conversationMemoryRepo.get(convId);
    const factsCtx = factsService.buildFactsContext(convId);
    const recent = contextWindowService.applyWindow(messages);
    
    const hasMemory = memory?.summary || (memory?.keyFacts?.length ?? 0) > 0;
    const hasFacts = factsCtx.length > 0;
    
    if (!hasMemory && !hasFacts && !sysPrompt) {
      return recent;
    }

    const parts: string[] = [];
    if (sysPrompt) parts.push(sysPrompt);
    if (hasFacts) parts.push(factsCtx);
    if (hasMemory) parts.push(this.formatMemory(memory!.summary, memory!.keyFacts));
    
    const ctx = parts.join('\n\n');
    const sysMsgs = recent.filter(m => m.role === 'system');
    const convMsgs = recent.filter(m => m.role !== 'system');

    const enhanced: ChatMessage = {
      role: 'system',
      content: sysMsgs.length ? `${sysMsgs.map(m => m.content).join('\n')}\n\n${ctx}` : ctx,
    };

    const factCount = factsService.getContextFacts(convId).length;
    console.log(`memory: prompt=${!!sysPrompt} facts=${factCount} summary=${!!memory?.summary}`);

    return [enhanced, ...convMsgs];
  }

  private formatMemory(summary: string | null, facts: string[]): string {
    const parts: string[] = [];
    if (summary) parts.push(`## Previous Summary\n${summary}`);
    if (facts?.length) parts.push(`## Key Facts\n${facts.map(f => `- ${f}`).join('\n')}`);
    return parts.join('\n\n');
  }

  async maybeSummarize(convId: string): Promise<boolean> {
    const msgs = messageRepo.listByConversation(convId);
    if (!conversationMemoryRepo.needsSummary(convId, msgs.length, SUMMARIZE_AFTER)) {
      return false;
    }

    const provider = this.getProvider();
    if (!provider) {
      console.log('memory: no provider for summarization');
      return false;
    }

    console.log(`memory: summarizing ${convId} (${msgs.length} msgs)`);

    try {
      const memory = conversationMemoryRepo.get(convId);
      const lastIdx = memory?.lastSummarizedMessageId
        ? msgs.findIndex(m => m.id === memory.lastSummarizedMessageId)
        : -1;

      const windowStart = Math.max(0, msgs.length - contextWindowService.getMaxMessages());
      const toSummarize = msgs.slice(lastIdx + 1, windowStart);

      if (toSummarize.length < 5) return false;

      const summary = await this.genSummary(provider, toSummarize, memory?.summary);
      
      if (summary) {
        const lastMsgId = toSummarize[toSummarize.length - 1].id;
        conversationMemoryRepo.updateSummary(convId, summary, msgs.length, lastMsgId);
        console.log('memory: summary updated');
        await this.extractFacts(provider, convId, toSummarize);
        return true;
      }
    } catch (e) {
      console.error('memory: summarization failed:', e);
    }

    return false;
  }

  private async genSummary(
    provider: { id: ProviderId; apiKey: string },
    msgs: Array<{ role: string; content: string }>,
    prevSummary?: string | null
  ): Promise<string | null> {
    const adapter = providerRegistry.get(provider.id);
    if (!adapter) return null;

    const text = msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const prompt = prevSummary
      ? `${SUMMARY_PROMPT}\n\nPrevious:\n${prevSummary}\n\nNew:\n${text}`
      : `${SUMMARY_PROMPT}\n\n${text}`;

    try {
      const gen = adapter.generate({ messages: [{ role: 'user', content: prompt }] }, provider.apiKey);
      let result = '';
      for await (const chunk of gen) {
        if (chunk.type === 'delta' && chunk.delta) result += chunk.delta;
      }
      return result.trim();
    } catch (e) {
      console.error('memory: summary gen error:', e);
      return null;
    }
  }

  private async extractFacts(
    provider: { id: ProviderId; apiKey: string },
    convId: string,
    msgs: Array<{ role: string; content: string }>
  ): Promise<void> {
    const adapter = providerRegistry.get(provider.id);
    if (!adapter) return;

    const text = msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const prompt = `${FACTS_PROMPT}\n\n${text}`;

    try {
      const gen = adapter.generate({ messages: [{ role: 'user', content: prompt }] }, provider.apiKey);
      let result = '';
      for await (const chunk of gen) {
        if (chunk.type === 'delta' && chunk.delta) result += chunk.delta;
      }

      const match = result.match(/\[[\s\S]*\]/);
      if (match) {
        const facts = JSON.parse(match[0]) as string[];
        if (facts?.length) {
          conversationMemoryRepo.addKeyFacts(convId, facts);
          console.log(`memory: extracted ${facts.length} facts`);
        }
      }
    } catch (e) {
      console.error('memory: fact extraction error:', e);
    }
  }

  private getProvider(): { id: ProviderId; apiKey: string } | null {
    // prefer fast/cheap for summarization
    const order: ProviderId[] = ['groq', 'cerebras', 'mistral', 'cohere', 'google', 'nvidia'];
    for (const id of order) {
      const key = providerRepo.getKey(id);
      if (key) return { id, apiKey: key };
    }
    return null;
  }

  async forceSummarize(convId: string): Promise<boolean> {
    const provider = this.getProvider();
    if (!provider) return false;

    const msgs = messageRepo.listByConversation(convId);
    if (msgs.length < 5) return false;

    const summary = await this.genSummary(provider, msgs);
    if (summary) {
      const lastId = msgs[msgs.length - 1].id;
      conversationMemoryRepo.updateSummary(convId, summary, msgs.length, lastId);
      await this.extractFacts(provider, convId, msgs);
      return true;
    }
    return false;
  }

  getMemory(convId: string) {
    return conversationMemoryRepo.get(convId);
  }

  addKeyFact(convId: string, fact: string): void {
    conversationMemoryRepo.addKeyFacts(convId, [fact]);
  }

  removeKeyFact(convId: string, fact: string): void {
    conversationMemoryRepo.removeKeyFact(convId, fact);
  }

  clearMemory(convId: string): void {
    conversationMemoryRepo.delete(convId);
  }
}

export const memoryService = new MemoryService();
