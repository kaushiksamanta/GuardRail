import { Etcd3 } from "etcd3";
import {
  CircuitBreakerStats,
  StateStore,
  CircuitBreakerState,
} from "./types.js";

export class EtcdStateStore implements StateStore {
  private readonly client: Etcd3;
  private readonly keyPrefix = "circuit-breaker/";

  constructor(config?: { hosts: string[] }) {
    this.client = new Etcd3(config);
  }

  private getKey(serviceKey: string): string {
    return `${this.keyPrefix}${serviceKey}`;
  }

  async getState(serviceKey: string): Promise<CircuitBreakerStats | null> {
    const key = this.getKey(serviceKey);
    const value = await this.client.get(key).string();

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as CircuitBreakerStats;
    } catch (error) {
      throw new Error(
        `Failed to parse circuit breaker state: ${String(error)}`,
      );
    }
  }

  async setState(
    serviceKey: string,
    stats: CircuitBreakerStats,
  ): Promise<void> {
    const key = this.getKey(serviceKey);
    await this.client.put(key).value(JSON.stringify(stats));
  }

  async incrementFailureCount(serviceKey: string): Promise<number> {
    const currentStats = await this.getState(serviceKey);
    if (currentStats) {
      const updatedStats = {
        ...currentStats,
        failureCount: currentStats.failureCount + 1,
        failedRequests: currentStats.failedRequests + 1,
        totalRequests: currentStats.totalRequests + 1,
        lastFailureTime: Date.now(),
      };
      await this.setState(serviceKey, updatedStats);
      return updatedStats.failureCount;
    } else {
      const initialStats: CircuitBreakerStats = {
        state: CircuitBreakerState.CLOSED,
        failureCount: 1,
        failedRequests: 1,
        totalRequests: 1,
        successfulRequests: 0,
        lastFailureTime: Date.now(),
        lastSuccessTime: null,
        lastError: null,
      };
      await this.setState(serviceKey, initialStats);
      return 1;
    }
  }

  async resetStats(serviceKey: string): Promise<void> {
    const currentStats = await this.getState(serviceKey);
    if (currentStats) {
      const resetStats = {
        ...currentStats,
        failureCount: 0,
        lastFailureTime: null,
        lastError: null,
      };
      await this.setState(serviceKey, resetStats);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    return this.client.close();
  }

  watchState(
    serviceKey: string,
    callback: (stats: CircuitBreakerStats) => void,
  ): void {
    const key = this.getKey(serviceKey);
    void this.client
      .watch()
      .key(key)
      .create()
      .then((watcher) => {
        watcher.on("put", (response) => {
          try {
            const stats = JSON.parse(
              response.value.toString(),
            ) as CircuitBreakerStats;
            callback(stats);
          } catch (error) {
            console.error("Failed to parse watched state:", error);
          }
        });
      })
      .catch((error) => {
        console.error("Failed to create watcher:", error);
      });
  }
}
