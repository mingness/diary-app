/**
 * Per-account failure throttle (engineering standards §12.4), complementing the per-IP rate limits: after
 * `maxFailures` within `windowMs`, the key is blocked until the window passes. Used for passwords per
 * username and authenticator codes per user.
 *
 * Kept in memory: correct for the single server instance we run. With several instances each would count
 * separately; move this to the database or Redis before scaling out.
 */
const MAX_TRACKED_KEYS = 10_000;

export interface ThrottleOptions {
  readonly maxFailures: number;
  readonly windowMs: number;
}

export class FailureThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly options: ThrottleOptions,
    private readonly clock: () => Date,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.clock().getTime() - this.options.windowMs;
    const kept = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);
    return kept;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.options.maxFailures;
  }

  recordFailure(key: string): void {
    // Someone trying many different usernames would otherwise grow the map without bound.
    if (this.failures.size >= MAX_TRACKED_KEYS) {
      for (const k of [...this.failures.keys()]) this.recent(k);
    }
    this.failures.set(key, [...this.recent(key), this.clock().getTime()]);
  }

  /** Number of keys currently tracked (for tests and monitoring). */
  get trackedKeys(): number {
    return this.failures.size;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
