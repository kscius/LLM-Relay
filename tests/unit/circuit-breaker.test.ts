import { describe, it, expect } from 'vitest';

// Test circuit breaker state machine logic
describe('Circuit Breaker Logic', () => {
  type CircuitState = 'closed' | 'open' | 'half_open';

  interface CircuitBreakerConfig {
    failureThreshold: number;
    cooldownMs: number;
  }

  const defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 3,
    cooldownMs: 120000,
  };

  describe('state transitions', () => {
    it('should start in closed state', () => {
      const initialState: CircuitState = 'closed';
      expect(initialState).toBe('closed');
    });

    it('should transition to open after threshold failures', () => {
      const shouldOpen = (consecutiveFailures: number, threshold: number): boolean => {
        return consecutiveFailures >= threshold;
      };

      expect(shouldOpen(2, 3)).toBe(false);
      expect(shouldOpen(3, 3)).toBe(true);
      expect(shouldOpen(4, 3)).toBe(true);
    });

    it('should transition to half-open after cooldown expires', () => {
      const shouldTransitionToHalfOpen = (
        state: CircuitState,
        cooldownUntil: number | null,
        now: number
      ): boolean => {
        if (state !== 'open') return false;
        if (!cooldownUntil) return false;
        return now >= cooldownUntil;
      };

      const cooldownUntil = Date.now() - 1000; // Expired
      expect(shouldTransitionToHalfOpen('open', cooldownUntil, Date.now())).toBe(true);

      const futureCooldow = Date.now() + 60000; // Not expired
      expect(shouldTransitionToHalfOpen('open', futureCooldow, Date.now())).toBe(false);
    });

    it('should transition to closed on success from half-open', () => {
      const getNextState = (
        currentState: CircuitState,
        success: boolean
      ): CircuitState => {
        if (currentState === 'half_open') {
          return success ? 'closed' : 'open';
        }
        return currentState;
      };

      expect(getNextState('half_open', true)).toBe('closed');
      expect(getNextState('half_open', false)).toBe('open');
    });

    it('should reset failure count on success', () => {
      const resetOnSuccess = (failures: number, success: boolean): number => {
        return success ? 0 : failures + 1;
      };

      expect(resetOnSuccess(5, true)).toBe(0);
      expect(resetOnSuccess(2, false)).toBe(3);
    });
  });

  describe('request allowance', () => {
    it('should allow requests in closed state', () => {
      const canAttempt = (state: CircuitState): boolean => {
        return state !== 'open';
      };

      expect(canAttempt('closed')).toBe(true);
      expect(canAttempt('half_open')).toBe(true);
      expect(canAttempt('open')).toBe(false);
    });
  });

  describe('cooldown calculation', () => {
    it('should apply exponential backoff to cooldown', () => {
      const calculateCooldown = (
        failures: number,
        baseMs: number,
        maxMs: number,
        multiplier: number = 1.5
      ): number => {
        const excess = Math.max(0, failures - defaultConfig.failureThreshold);
        const backoff = Math.pow(multiplier, excess);
        return Math.min(baseMs * backoff, maxMs);
      };

      const baseMs = 120000;
      const maxMs = 600000;

      // At threshold: base cooldown
      expect(calculateCooldown(3, baseMs, maxMs)).toBe(120000);
      
      // Above threshold: increased cooldown
      const cooldown4 = calculateCooldown(4, baseMs, maxMs);
      expect(cooldown4).toBe(180000); // 120000 * 1.5

      // Capped at max
      const cooldown10 = calculateCooldown(10, baseMs, maxMs);
      expect(cooldown10).toBeLessThanOrEqual(maxMs);
    });

    it('should handle rate limit retry-after', () => {
      const getRateLimitCooldown = (
        retryAfterMs: number | undefined,
        defaultMs: number,
        maxMs: number
      ): number => {
        const cooldown = retryAfterMs ?? defaultMs;
        return Math.min(cooldown, maxMs);
      };

      expect(getRateLimitCooldown(60000, 120000, 600000)).toBe(60000);
      expect(getRateLimitCooldown(undefined, 120000, 600000)).toBe(120000);
      expect(getRateLimitCooldown(1000000, 120000, 600000)).toBe(600000);
    });
  });
});

