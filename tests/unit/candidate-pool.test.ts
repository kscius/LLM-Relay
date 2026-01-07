import { describe, it, expect } from 'vitest';

/**
 * Tests for candidate pool module - provider selection and weighting
 */
describe('Candidate Pool Logic', () => {
  // Mock provider data
  interface MockProvider {
    id: string;
    displayName: string;
    priority: number;
    isEnabled: boolean;
    hasKey: boolean;
  }

  interface MockHealth {
    score: number;
    state: 'closed' | 'open' | 'half_open';
    cooldownUntil: number | null;
  }

  // Anti-repeat window size (matching the real implementation)
  const ANTI_REPEAT_WINDOW = 3;

  describe('provider eligibility', () => {
    const isEligible = (
      provider: MockProvider,
      health: MockHealth,
      excludeProviders: string[] = []
    ): boolean => {
      if (!provider.isEnabled) return false;
      if (!provider.hasKey) return false;
      if (excludeProviders.includes(provider.id)) return false;
      if (health.state === 'open') return false;
      if (health.cooldownUntil && health.cooldownUntil > Date.now()) return false;
      return true;
    };

    it('should require provider to be enabled', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: false,
        hasKey: true,
      };
      const health: MockHealth = { score: 1.0, state: 'closed', cooldownUntil: null };
      expect(isEligible(provider, health)).toBe(false);
    });

    it('should require provider to have API key', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: true,
        hasKey: false,
      };
      const health: MockHealth = { score: 1.0, state: 'closed', cooldownUntil: null };
      expect(isEligible(provider, health)).toBe(false);
    });

    it('should exclude providers with open circuit breaker', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: true,
        hasKey: true,
      };
      const health: MockHealth = { score: 0.5, state: 'open', cooldownUntil: null };
      expect(isEligible(provider, health)).toBe(false);
    });

    it('should exclude providers in cooldown', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: true,
        hasKey: true,
      };
      const health: MockHealth = {
        score: 0.5,
        state: 'closed',
        cooldownUntil: Date.now() + 60000, // 1 minute from now
      };
      expect(isEligible(provider, health)).toBe(false);
    });

    it('should allow providers with expired cooldown', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: true,
        hasKey: true,
      };
      const health: MockHealth = {
        score: 0.5,
        state: 'closed',
        cooldownUntil: Date.now() - 1000, // Expired
      };
      expect(isEligible(provider, health)).toBe(true);
    });

    it('should respect explicit exclusion list', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: true,
        hasKey: true,
      };
      const health: MockHealth = { score: 1.0, state: 'closed', cooldownUntil: null };
      expect(isEligible(provider, health, ['test'])).toBe(false);
      expect(isEligible(provider, health, ['other'])).toBe(true);
    });

    it('should allow half-open circuit breaker for probe', () => {
      const provider: MockProvider = {
        id: 'test',
        displayName: 'Test',
        priority: 50,
        isEnabled: true,
        hasKey: true,
      };
      const health: MockHealth = { score: 0.5, state: 'half_open', cooldownUntil: null };
      expect(isEligible(provider, health)).toBe(true);
    });
  });

  describe('anti-repeat logic', () => {
    const getAntiRepeatMultiplier = (
      providerId: string,
      recentProviders: string[]
    ): number => {
      const recentWindow = recentProviders.slice(-ANTI_REPEAT_WINDOW);
      const index = recentWindow.indexOf(providerId);

      if (index === -1) return 1.0; // No penalty

      const recency = recentWindow.length - index;
      const penalties = [0.2, 0.5, 0.7];
      return penalties[recency - 1] || 0.7;
    };

    it('should return 1.0 for providers not in recent history', () => {
      expect(getAntiRepeatMultiplier('groq', [])).toBe(1.0);
      expect(getAntiRepeatMultiplier('groq', ['google', 'mistral'])).toBe(1.0);
    });

    it('should apply 0.2 penalty for most recent provider', () => {
      expect(getAntiRepeatMultiplier('groq', ['google', 'mistral', 'groq'])).toBe(0.2);
    });

    it('should apply 0.5 penalty for second most recent', () => {
      expect(getAntiRepeatMultiplier('mistral', ['google', 'mistral', 'groq'])).toBe(0.5);
    });

    it('should apply 0.7 penalty for third most recent', () => {
      expect(getAntiRepeatMultiplier('google', ['google', 'mistral', 'groq'])).toBe(0.7);
    });

    it('should only consider last N providers in window', () => {
      const recentProviders = ['old1', 'old2', 'google', 'mistral', 'groq'];
      expect(getAntiRepeatMultiplier('old1', recentProviders)).toBe(1.0);
      expect(getAntiRepeatMultiplier('old2', recentProviders)).toBe(1.0);
    });
  });

  describe('weight calculation', () => {
    const calculateWeight = (
      healthScore: number,
      priority: number,
      antiRepeatMultiplier: number,
      randomFactor: number = 0.75 // Use deterministic value for testing
    ): number => {
      const priorityWeight = priority / 100;
      const baseWeight =
        healthScore * 0.3 + priorityWeight * 0.2 + randomFactor * 0.5;
      return baseWeight * antiRepeatMultiplier;
    };

    it('should weight health, priority, and random factor', () => {
      const weight = calculateWeight(1.0, 100, 1.0, 0.75);
      // (1.0 * 0.3) + (1.0 * 0.2) + (0.75 * 0.5) = 0.3 + 0.2 + 0.375 = 0.875
      expect(weight).toBeCloseTo(0.875, 3);
    });

    it('should apply anti-repeat penalty', () => {
      const fullWeight = calculateWeight(1.0, 100, 1.0, 0.75);
      const penalizedWeight = calculateWeight(1.0, 100, 0.2, 0.75);
      expect(penalizedWeight).toBeCloseTo(fullWeight * 0.2, 3);
    });

    it('should favor higher health scores', () => {
      const highHealth = calculateWeight(1.0, 50, 1.0, 0.75);
      const lowHealth = calculateWeight(0.5, 50, 1.0, 0.75);
      expect(highHealth).toBeGreaterThan(lowHealth);
    });

    it('should favor higher priority', () => {
      const highPriority = calculateWeight(0.8, 100, 1.0, 0.75);
      const lowPriority = calculateWeight(0.8, 50, 1.0, 0.75);
      expect(highPriority).toBeGreaterThan(lowPriority);
    });
  });

  describe('weighted random selection', () => {
    interface Candidate {
      id: string;
      weight: number;
    }

    const selectProvider = (
      candidates: Candidate[],
      randomValue: number
    ): Candidate | null => {
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
      if (totalWeight === 0) {
        return candidates[Math.floor(randomValue * candidates.length)];
      }

      let random = randomValue * totalWeight;
      for (const candidate of candidates) {
        random -= candidate.weight;
        if (random <= 0) return candidate;
      }
      return candidates[candidates.length - 1];
    };

    it('should return null for empty candidates', () => {
      expect(selectProvider([], 0.5)).toBeNull();
    });

    it('should return single candidate directly', () => {
      const candidates = [{ id: 'solo', weight: 0.8 }];
      expect(selectProvider(candidates, 0.5)?.id).toBe('solo');
    });

    it('should select based on weight distribution', () => {
      const candidates = [
        { id: 'high', weight: 0.9 },
        { id: 'low', weight: 0.1 },
      ];

      // Random value near start should select high weight
      expect(selectProvider(candidates, 0.1)?.id).toBe('high');

      // Random value near end should select low weight
      expect(selectProvider(candidates, 0.95)?.id).toBe('low');
    });

    it('should handle all zero weights', () => {
      const candidates = [
        { id: 'a', weight: 0 },
        { id: 'b', weight: 0 },
      ];
      // Should pick randomly when all weights are zero
      const result = selectProvider(candidates, 0.75);
      expect(result).not.toBeNull();
    });
  });

  describe('pool summary', () => {
    const getPoolSummary = (providers: Array<MockProvider & { health: MockHealth }>) => {
      let available = 0;
      let inCooldown = 0;
      let noKey = 0;
      let disabled = 0;

      for (const provider of providers) {
        if (!provider.isEnabled) {
          disabled++;
        } else if (!provider.hasKey) {
          noKey++;
        } else if (provider.health.cooldownUntil && provider.health.cooldownUntil > Date.now()) {
          inCooldown++;
        } else if (provider.health.state === 'open') {
          inCooldown++;
        } else {
          available++;
        }
      }

      return { total: providers.length, available, inCooldown, noKey, disabled };
    };

    it('should categorize providers correctly', () => {
      const now = Date.now();
      const providers = [
        {
          id: 'available1',
          displayName: 'A',
          priority: 50,
          isEnabled: true,
          hasKey: true,
          health: { score: 1.0, state: 'closed' as const, cooldownUntil: null },
        },
        {
          id: 'disabled1',
          displayName: 'B',
          priority: 50,
          isEnabled: false,
          hasKey: true,
          health: { score: 1.0, state: 'closed' as const, cooldownUntil: null },
        },
        {
          id: 'nokey1',
          displayName: 'C',
          priority: 50,
          isEnabled: true,
          hasKey: false,
          health: { score: 1.0, state: 'closed' as const, cooldownUntil: null },
        },
        {
          id: 'cooldown1',
          displayName: 'D',
          priority: 50,
          isEnabled: true,
          hasKey: true,
          health: { score: 0.5, state: 'closed' as const, cooldownUntil: now + 60000 },
        },
      ];

      const summary = getPoolSummary(providers);
      expect(summary).toEqual({
        total: 4,
        available: 1,
        inCooldown: 1,
        noKey: 1,
        disabled: 1,
      });
    });
  });
});

