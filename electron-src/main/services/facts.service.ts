// Global facts - user preferences, project context, persistent memory

import { globalFactsRepo, type GlobalFact, type FactCategory, type CreateFactInput } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';
import { providerRepo } from '../database/repositories/index.js';

const EXTRACT_PROMPT = `Extract facts about the user from this message. Return JSON array:
[{"fact": "...", "category": "preference|personal|project|technical|temporary", "confidence": 0.0-1.0}]
Only clear facts, not assumptions. Empty array if none.

MESSAGE:
`;

const CONFLICT_PROMPT = `Compare facts and determine if they conflict:
EXISTING: "{existing}"
NEW: "{new_fact}"

Return JSON: {"conflicts": bool, "action": "keep_existing|replace|merge", "merged_fact": "...", "reason": "..."}
`;

class FactsService {
  async extractFactsFromMessage(content: string, convId: string, msgId?: string): Promise<GlobalFact[]> {
    if (content.length < 20) return [];

    const provider = this.getProvider();
    if (!provider) {
      console.log('facts: no provider for extraction');
      return [];
    }

    try {
      const resp = await this.callProvider(provider, EXTRACT_PROMPT + content);
      if (!resp) return [];

      const facts = this.parseFacts(resp);
      const saved: GlobalFact[] = [];

      for (const f of facts) {
        const existing = globalFactsRepo.findSimilar(f.fact, 0.7);
        
        if (existing.length) {
          const ex = existing[0];
          globalFactsRepo.update(ex.id, { confidence: Math.min(1.0, ex.confidence + 0.05) });
          console.log(`facts: bumped confidence for "${ex.fact}"`);
        } else {
          const created = globalFactsRepo.create({
            fact: f.fact,
            category: f.category as FactCategory,
            scope: 'global',
            confidence: f.confidence || 0.7,
            sourceMessageId: msgId,
            sourceConversationId: convId,
          });
          saved.push(created);
          console.log(`facts: new "${created.fact}" (${created.category})`);
        }
      }

      return saved;
    } catch (e) {
      console.error('facts: extraction failed:', e);
      return [];
    }
  }

  private parseFacts(resp: string): Array<{ fact: string; category: string; confidence: number }> {
    try {
      const match = resp.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const arr = JSON.parse(match[0]);
      if (!Array.isArray(arr)) return [];
      return arr.filter(x => 
        typeof x.fact === 'string' && x.fact.length > 5 &&
        ['preference', 'personal', 'project', 'technical', 'temporary'].includes(x.category)
      );
    } catch {
      return [];
    }
  }

  getContextFacts(convId?: string): GlobalFact[] {
    return convId ? globalFactsRepo.listForConversation(convId) : globalFactsRepo.listGlobal();
  }

  buildFactsContext(convId?: string): string {
    const facts = this.getContextFacts(convId);
    if (!facts.length) return '';

    const grouped: Record<string, GlobalFact[]> = {};
    for (const f of facts) {
      (grouped[f.category] ??= []).push(f);
    }

    const labels: Record<string, string> = {
      personal: 'Personal', preference: 'Preferences', project: 'Project',
      technical: 'Technical', temporary: 'Notes',
    };

    const parts = ['## Known Facts'];
    for (const [cat, list] of Object.entries(grouped)) {
      parts.push(`\n### ${labels[cat] || cat}`);
      for (const f of list) {
        const note = f.confidence < 0.8 ? ' (uncertain)' : '';
        parts.push(`- ${f.fact}${note}`);
      }
    }
    return parts.join('\n');
  }

  addFact(input: CreateFactInput): GlobalFact {
    return globalFactsRepo.addOrUpdate(input);
  }

  updateFact(id: string, updates: Partial<Pick<GlobalFact, 'fact' | 'category' | 'confidence' | 'isActive'>>): boolean {
    return globalFactsRepo.update(id, updates);
  }

  removeFact(id: string): boolean {
    return globalFactsRepo.deactivate(id);
  }

  deleteFact(id: string): boolean {
    return globalFactsRepo.delete(id);
  }

  listGlobalFacts(): GlobalFact[] {
    return globalFactsRepo.listGlobal();
  }

  listByCategory(cat: FactCategory): GlobalFact[] {
    return globalFactsRepo.listByCategory(cat);
  }

  getStats() {
    return globalFactsRepo.getStats();
  }

  async resolveConflict(existing: GlobalFact, newText: string): Promise<'keep' | 'replace' | 'merge'> {
    const provider = this.getProvider();
    if (!provider) return 'keep';

    try {
      const prompt = CONFLICT_PROMPT.replace('{existing}', existing.fact).replace('{new_fact}', newText);
      const resp = await this.callProvider(provider, prompt);
      if (!resp) return 'keep';

      const match = resp.match(/\{[\s\S]*\}/);
      if (!match) return 'keep';

      const result = JSON.parse(match[0]);
      if (result.action === 'replace') {
        globalFactsRepo.update(existing.id, { fact: newText, confidence: 0.9 });
        return 'replace';
      } else if (result.action === 'merge' && result.merged_fact) {
        globalFactsRepo.update(existing.id, { fact: result.merged_fact, confidence: 0.85 });
        return 'merge';
      }
      return 'keep';
    } catch (e) {
      console.error('facts: conflict resolution failed:', e);
      return 'keep';
    }
  }

  private getProvider(): { id: ProviderId; apiKey: string } | null {
    for (const id of ['groq', 'cerebras', 'mistral', 'google', 'cohere', 'nvidia'] as ProviderId[]) {
      const key = providerRepo.getKey(id);
      if (key) return { id, apiKey: key };
    }
    return null;
  }

  private async callProvider(prov: { id: ProviderId; apiKey: string }, prompt: string): Promise<string | null> {
    const adapter = providerRegistry.get(prov.id);
    if (!adapter) return null;

    try {
      const gen = adapter.generate({ messages: [{ role: 'user', content: prompt }] }, prov.apiKey);
      let result = '';
      for await (const chunk of gen) {
        if (chunk.type === 'delta' && chunk.delta) result += chunk.delta;
      }
      return result.trim();
    } catch (e) {
      console.error('facts: provider call failed:', e);
      return null;
    }
  }

  cleanupExpired(): void {
    globalFactsRepo.cleanupExpired();
  }
}

export const factsService = new FactsService();
