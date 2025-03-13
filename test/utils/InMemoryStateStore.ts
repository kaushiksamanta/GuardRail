import { StateStore, CircuitBreakerStats } from "../../src/types.js";

/**
 * A simple in-memory implementation of StateStore for testing purposes.
 * This combines the functionality of MockStateStore and CachedStateStore
 * into a single, simpler implementation.
 */
export class InMemoryStateStore implements StateStore {
  private readonly store = new Map<string, CircuitBreakerStats>();
  private readonly watchers = new Map<
    string,
    Set<(stats: CircuitBreakerStats) => void>
  >();

  /**
   * Creates a new instance of InMemoryStateStore
   */
  constructor() {
    // No initialization needed
  }

  /**
   * Get the state for a given key
   */
  async getState(key: string): Promise<CircuitBreakerStats | null> {
    return this.store.get(key) ?? null;
  }

  /**
   * Set the state for a given key
   */
  async setState(key: string, stats: CircuitBreakerStats): Promise<void> {
    this.store.set(key, stats);
    this.notifyWatchers(key, stats);
  }

  /**
   * Increment the failure count for a given key
   */
  async incrementFailureCount(key: string): Promise<number> {
    const stats = await this.getState(key);
    if (!stats) {
      return 0;
    }

    const now = Date.now();
    const updatedStats = {
      ...stats,
      failureCount: stats.failureCount + 1,
      failedRequests: stats.failedRequests + 1,
      lastFailureTime: now,
      lastUpdateTime: now,
    };

    await this.setState(key, updatedStats);
    return updatedStats.failureCount;
  }

  /**
   * Reset the stats for a given key
   */
  async resetStats(key: string): Promise<void> {
    const stats = await this.getState(key);
    if (stats) {
      const resetStats = {
        ...stats,
        failureCount: 0,
        failedRequests: 0,
        lastFailureTime: null,
        lastError: null,
        state: CircuitBreakerState.CLOSED,
      };
      await this.setState(key, resetStats);
    }
  }

  /**
   * Watch for state changes for a given key
   */
  watchState(
    key: string,
    callback: (stats: CircuitBreakerStats) => void,
  ): void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key)?.add(callback);
  }

  /**
   * Close the store and clean up resources
   */
  async close(): Promise<void> {
    // Clear the store and watchers
    this.store.clear();
    this.watchers.clear();
  }

  /**
   * Notify watchers of state changes
   */
  private notifyWatchers(key: string, stats: CircuitBreakerStats): void {
    this.watchers.get(key)?.forEach((callback) => callback(stats));
  }
}

// Re-export CircuitBreakerState for convenience
import { CircuitBreakerState } from "../../src/types.js";
export { CircuitBreakerState };
