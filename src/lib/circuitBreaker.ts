// ── Circuit Breaker ────────────────────────────────────────────────
// Simple stateful circuit breaker for external API calls.
// After N consecutive failures, opens the circuit for cooldownMs.
// Half-open: allows 1 probe request. If it succeeds, closes the circuit.
// If it fails, re-opens and resets the cooldown timer.

export interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

interface CircuitBreakerOptions {
  name: string;
  maxFailures?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  readonly name: string;
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private readonly maxFailures: number;
  private readonly cooldownMs: number;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.maxFailures = opts.maxFailures ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  get isOpen(): boolean {
    if (this.state === 'closed') return false;
    if (this.state === 'half-open') return false;
    // Open: check if cooldown expired
    if (Date.now() - this.lastFailureTime > this.cooldownMs) {
      this.state = 'half-open';
      return false; // allow probe
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.maxFailures || this.state === 'half-open') {
      this.state = 'open';
    }
  }

  getStatus(): CircuitBreakerState {
    return { failures: this.failures, lastFailureTime: this.lastFailureTime, state: this.state };
  }
}

// Per-source breakers
export const breakers = {
  fotmob: new CircuitBreaker({ name: 'fotmob', maxFailures: 5, cooldownMs: 30_000 }),
  goaloo: new CircuitBreaker({ name: 'goaloo', maxFailures: 5, cooldownMs: 30_000 }),
  netscores: new CircuitBreaker({ name: 'netscores', maxFailures: 5, cooldownMs: 60_000 }),
  sofascore: new CircuitBreaker({ name: 'sofascore', maxFailures: 3, cooldownMs: 60_000 }),
  scoremer: new CircuitBreaker({ name: 'scoremer', maxFailures: 5, cooldownMs: 30_000 }),
  nesine: new CircuitBreaker({ name: 'nesine', maxFailures: 3, cooldownMs: 15_000 }),
};
