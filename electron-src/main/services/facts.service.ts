/**
 * Facts Service
 * 
 * Advanced fact management with:
 * - Real-time fact detection from messages
 * - Categorization and confidence scoring
 * - Global vs conversation-scoped facts
 * - Conflict resolution
 */

import { globalFactsRepo, type GlobalFact, type FactCategory, type CreateFactInput } from '../database/repositories/index.js';
import { providerRegistry, type ProviderId } from '../providers/index.js';
import { providerRepo } from '../database/repositories/index.js';

// Prompt for extracting facts from a message
const FACT_EXTRACTION_PROMPT = `Analyze this message and extract any facts about the user that would be useful to remember.

Focus on:
1. **Personal info**: name, role, location, company
2. **Preferences**: preferred programming languages, tools, coding style, communication preferences
3. **Project context**: current project, technologies being used, deadlines
4. **Technical constraints**: system requirements, limitations, dependencies

For each fact, provide:
- fact: the information to remember (concise, one sentence)
- category: one of [preference, personal, project, technical, temporary]
- confidence: 0.0 to 1.0 (how certain based on explicit vs implied)

Return a JSON array. Only include clear facts, not assumptions.
If no facts found, return empty array [].

Example output:
[
  {"fact": "User prefers TypeScript over JavaScript", "category": "preference", "confidence": 0.9},
  {"fact": "User is working on a React dashboard project", "category": "project", "confidence": 0.85}
]

MESSAGE:
`;

// Prompt for detecting fact conflicts
const CONFLICT_DETECTION_PROMPT = `Compare these two facts and determine if they conflict:

EXISTING FACT: "{existing}"
NEW FACT: "{new_fact}"

Respond with JSON:
{
  "conflicts": true/false,
  "action": "keep_existing" | "replace" | "merge" | "keep_both",
  "merged_fact": "if action is merge, provide the merged fact text",
  "reason": "brief explanation"
}
`;

class FactsService {
  /**
   * Extract facts from a message in real-time
   */
  async extractFactsFromMessage(
    content: string,
    conversationId: string,
    messageId?: string
  ): Promise<GlobalFact[]> {
    // Skip very short messages
    if (content.length < 20) {
      return [];
    }

    // Get a fast provider for extraction
    const provider = this.getFastProvider();
    if (!provider) {
      console.log('[Facts] No provider available for fact extraction');
      return [];
    }

    try {
      const prompt = FACT_EXTRACTION_PROMPT + content;
      const response = await this.callProvider(provider, prompt);
      
      if (!response) return [];

      // Parse the response
      const facts = this.parseFactsResponse(response);
      const savedFacts: GlobalFact[] = [];

      for (const factData of facts) {
        // Check for conflicts/duplicates
        const existing = globalFactsRepo.findSimilar(factData.fact, 0.7);
        
        if (existing.length > 0) {
          // Update confidence of existing fact
          const existingFact = existing[0];
          const newConfidence = Math.min(1.0, existingFact.confidence + 0.05);
          globalFactsRepo.update(existingFact.id, { confidence: newConfidence });
          console.log(`[Facts] Updated confidence for existing fact: "${existingFact.fact}"`);
        } else {
          // Create new fact
          const newFact = globalFactsRepo.create({
            fact: factData.fact,
            category: factData.category as FactCategory,
            scope: 'global',  // Most extracted facts should be global
            confidence: factData.confidence || 0.7,
            sourceMessageId: messageId,
            sourceConversationId: conversationId,
          });
          savedFacts.push(newFact);
          console.log(`[Facts] Extracted new fact: "${newFact.fact}" (${newFact.category})`);
        }
      }

      return savedFacts;
    } catch (error) {
      console.error('[Facts] Extraction failed:', error);
      return [];
    }
  }

  /**
   * Parse facts from LLM response
   */
  private parseFactsResponse(response: string): Array<{ fact: string; category: string; confidence: number }> {
    try {
      // Find JSON array in response
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) return [];

      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(item => 
        typeof item.fact === 'string' && 
        item.fact.length > 5 &&
        ['preference', 'personal', 'project', 'technical', 'temporary'].includes(item.category)
      );
    } catch {
      return [];
    }
  }

  /**
   * Get all facts relevant for a conversation context
   */
  getContextFacts(conversationId?: string): GlobalFact[] {
    if (conversationId) {
      return globalFactsRepo.listForConversation(conversationId);
    }
    return globalFactsRepo.listGlobal();
  }

  /**
   * Build a context string from facts for injection into prompts
   */
  buildFactsContext(conversationId?: string): string {
    const facts = this.getContextFacts(conversationId);
    
    if (facts.length === 0) {
      return '';
    }

    // Group facts by category
    const grouped: Record<string, GlobalFact[]> = {};
    for (const fact of facts) {
      if (!grouped[fact.category]) {
        grouped[fact.category] = [];
      }
      grouped[fact.category].push(fact);
    }

    // Build context string
    const parts: string[] = ['## Known Facts About This User'];
    
    const categoryLabels: Record<string, string> = {
      personal: 'Personal Information',
      preference: 'Preferences',
      project: 'Current Project',
      technical: 'Technical Context',
      temporary: 'Temporary Notes',
    };

    for (const [category, categoryFacts] of Object.entries(grouped)) {
      const label = categoryLabels[category] || category;
      parts.push(`\n### ${label}`);
      for (const fact of categoryFacts) {
        const confidence = fact.confidence >= 0.8 ? '' : ' (uncertain)';
        parts.push(`- ${fact.fact}${confidence}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Add a fact manually
   */
  addFact(input: CreateFactInput): GlobalFact {
    return globalFactsRepo.addOrUpdate(input);
  }

  /**
   * Update a fact
   */
  updateFact(id: string, updates: Partial<Pick<GlobalFact, 'fact' | 'category' | 'confidence' | 'isActive'>>): boolean {
    return globalFactsRepo.update(id, updates);
  }

  /**
   * Remove a fact
   */
  removeFact(id: string): boolean {
    return globalFactsRepo.deactivate(id);
  }

  /**
   * Permanently delete a fact
   */
  deleteFact(id: string): boolean {
    return globalFactsRepo.delete(id);
  }

  /**
   * List all global facts
   */
  listGlobalFacts(): GlobalFact[] {
    return globalFactsRepo.listGlobal();
  }

  /**
   * List facts by category
   */
  listByCategory(category: FactCategory): GlobalFact[] {
    return globalFactsRepo.listByCategory(category);
  }

  /**
   * Get fact statistics
   */
  getStats() {
    return globalFactsRepo.getStats();
  }

  /**
   * Check for and resolve fact conflicts
   */
  async resolveConflict(existingFact: GlobalFact, newFactText: string): Promise<'keep' | 'replace' | 'merge'> {
    const provider = this.getFastProvider();
    if (!provider) {
      return 'keep_both' as any; // Default to keeping both if no provider
    }

    try {
      const prompt = CONFLICT_DETECTION_PROMPT
        .replace('{existing}', existingFact.fact)
        .replace('{new_fact}', newFactText);

      const response = await this.callProvider(provider, prompt);
      if (!response) return 'keep';

      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return 'keep';

      const result = JSON.parse(match[0]);
      
      if (result.action === 'replace') {
        globalFactsRepo.update(existingFact.id, { fact: newFactText, confidence: 0.9 });
        return 'replace';
      } else if (result.action === 'merge' && result.merged_fact) {
        globalFactsRepo.update(existingFact.id, { fact: result.merged_fact, confidence: 0.85 });
        return 'merge';
      }
      
      return 'keep';
    } catch (error) {
      console.error('[Facts] Conflict resolution failed:', error);
      return 'keep';
    }
  }

  /**
   * Get a fast provider for fact extraction (prefer Groq/Cerebras)
   */
  private getFastProvider(): { id: ProviderId; apiKey: string } | null {
    const preferredOrder: ProviderId[] = ['groq', 'cerebras', 'mistral', 'google', 'cohere', 'nvidia'];
    
    for (const id of preferredOrder) {
      const apiKey = providerRepo.getKey(id);
      if (apiKey) {
        return { id, apiKey };
      }
    }
    return null;
  }

  /**
   * Call a provider for fact extraction
   */
  private async callProvider(
    provider: { id: ProviderId; apiKey: string },
    prompt: string
  ): Promise<string | null> {
    const adapter = providerRegistry.get(provider.id);
    if (!adapter) return null;

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
      console.error('[Facts] Provider call failed:', error);
      return null;
    }
  }

  /**
   * Cleanup expired temporary facts
   */
  cleanupExpired(): void {
    globalFactsRepo.cleanupExpired();
  }
}

export const factsService = new FactsService();

