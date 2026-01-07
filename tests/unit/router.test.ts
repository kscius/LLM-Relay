import { describe, it, expect } from 'vitest';

// Test pure routing logic without database dependencies
describe('Router Logic', () => {
  interface CandidateProvider {
    id: string;
    weight: number;
  }

  describe('selectProvider (weighted random)', () => {
    const selectProvider = (candidates: CandidateProvider[]): CandidateProvider | null => {
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);

      if (totalWeight === 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }

      let random = Math.random() * totalWeight;
      
      for (const candidate of candidates) {
        random -= candidate.weight;
        if (random <= 0) {
          return candidate;
        }
      }

      return candidates[0];
    };

    it('should return null for empty candidates', () => {
      expect(selectProvider([])).toBeNull();
    });

    it('should return the only candidate for single-item list', () => {
      const candidates = [{ id: 'openai', weight: 1.0 }];
      expect(selectProvider(candidates)?.id).toBe('openai');
    });

    it('should handle zero-weight candidates', () => {
      const candidates = [
        { id: 'openai', weight: 0 },
        { id: 'anthropic', weight: 0 },
      ];
      const result = selectProvider(candidates);
      expect(result).not.toBeNull();
      expect(['openai', 'anthropic']).toContain(result?.id);
    });

    it('should favor higher-weight candidates over many iterations', () => {
      const candidates = [
        { id: 'high', weight: 0.9 },
        { id: 'low', weight: 0.1 },
      ];

      const counts: Record<string, number> = { high: 0, low: 0 };
      
      for (let i = 0; i < 1000; i++) {
        const result = selectProvider(candidates);
        if (result) counts[result.id]++;
      }

      // High-weight should be selected significantly more often
      expect(counts.high).toBeGreaterThan(counts.low * 2);
    });
  });

  describe('exponential backoff', () => {
    const calculateBackoff = (
      attempt: number,
      baseDelayMs: number = 1000,
      maxDelayMs: number = 30000
    ): number => {
      return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
    };

    it('should return base delay for first attempt', () => {
      expect(calculateBackoff(1)).toBe(1000);
    });

    it('should double delay for each attempt', () => {
      expect(calculateBackoff(2)).toBe(2000);
      expect(calculateBackoff(3)).toBe(4000);
      expect(calculateBackoff(4)).toBe(8000);
    });

    it('should cap at max delay', () => {
      expect(calculateBackoff(10)).toBe(30000);
      expect(calculateBackoff(20)).toBe(30000);
    });

    it('should respect custom base and max', () => {
      expect(calculateBackoff(1, 500, 5000)).toBe(500);
      expect(calculateBackoff(5, 500, 5000)).toBe(5000);
    });
  });

  describe('cooldown calculation', () => {
    const calculateCooldown = (
      failures: number,
      baseMs: number = 120000,
      maxMs: number = 600000,
      multiplier: number = 1.5
    ): number => {
      const threshold = 3;
      const backoffFactor = Math.pow(multiplier, failures - threshold);
      return Math.min(baseMs * backoffFactor, maxMs);
    };

    it('should return base cooldown at threshold', () => {
      expect(calculateCooldown(3)).toBe(120000);
    });

    it('should increase cooldown with more failures', () => {
      const cooldown3 = calculateCooldown(3);
      const cooldown4 = calculateCooldown(4);
      const cooldown5 = calculateCooldown(5);
      
      expect(cooldown4).toBeGreaterThan(cooldown3);
      expect(cooldown5).toBeGreaterThan(cooldown4);
    });

    it('should cap at max cooldown', () => {
      expect(calculateCooldown(20)).toBe(600000);
    });
  });

  describe('anti-repeat window', () => {
    const shouldExclude = (
      providerId: string,
      recentProviders: string[],
      windowSize: number = 2
    ): boolean => {
      const window = recentProviders.slice(-windowSize);
      return window.includes(providerId);
    };

    it('should exclude recently used providers', () => {
      const recent = ['openai', 'anthropic'];
      expect(shouldExclude('openai', recent)).toBe(true);
      expect(shouldExclude('anthropic', recent)).toBe(true);
    });

    it('should allow providers outside window', () => {
      const recent = ['openai', 'anthropic'];
      expect(shouldExclude('google', recent)).toBe(false);
    });

    it('should only consider last N providers', () => {
      const recent = ['openai', 'anthropic', 'google'];
      // Window of 2, so only last 2 count
      expect(shouldExclude('openai', recent, 2)).toBe(false);
      expect(shouldExclude('anthropic', recent, 2)).toBe(true);
      expect(shouldExclude('google', recent, 2)).toBe(true);
    });

    it('should handle empty recent list', () => {
      expect(shouldExclude('openai', [])).toBe(false);
    });
  });
});

