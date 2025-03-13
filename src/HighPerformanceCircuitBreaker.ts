import { EventEmitter } from "events";
import {
  CircuitBreakerState,
  CircuitBreakerOptions,
  CircuitBreakerStats,
  ServiceCall,
  StateStore,
  CircuitBreakerMetrics,
} from "./types.js";

export class HighPerformanceCircuitBreaker extends EventEmitter {
  private readonly options: CircuitBreakerOptions;
  private readonly serviceKey: string;
  private readonly stateStore: StateStore;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private readonly activeRequests: Set<symbol> = new Set();
  private readonly metrics: CircuitBreakerMetrics = {
    requestRate: 0,
    errorRate: 0,
    averageResponseTime: 0,
    currentLoad: 0,
    lastMinuteStats: {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
    },
  };
  private requestTimes: number[] = [];
  private errorTimes: number[] = [];
  private lastMetricsUpdate: number = Date.now();
  private readonly responseTimes: number[] = [];

  constructor(
    serviceKey: string,
    stateStore: StateStore,
    options: Partial<CircuitBreakerOptions> = {},
  ) {
    super();
    this.serviceKey = serviceKey;
    this.stateStore = stateStore;
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      resetTimeout: options.resetTimeout ?? 60000,
      halfOpenRetryLimit: options.halfOpenRetryLimit ?? 1,
      monitorInterval: options.monitorInterval ?? 30000,
      serviceTimeout: options.serviceTimeout ?? 5000,
      maxConcurrent: options.maxConcurrent ?? 10000,
    };

    void this.init().catch((error) => {
      console.error("Failed to initialize circuit breaker:", error);
    });
  }

  private async init(): Promise<void> {
    try {
      await this.initializeState();

      this.startHealthCheck();
      this.startMetricsCollection();
      this.watchStateChanges();
    } catch (error) {
      console.error("Failed to initialize circuit breaker:", error);
      throw error;
    }
  }

  private async initializeState(): Promise<void> {
    const stats = await this.stateStore.getState(this.serviceKey);
    if (!stats) {
      // Initialize with default state
      await this.stateStore.setState(this.serviceKey, {
        state: CircuitBreakerState.CLOSED,
        failureCount: 0,
        lastFailureTime: null,
        lastSuccessTime: Date.now(),
        lastError: null,
        totalRequests: 0,
        failedRequests: 0,
        successfulRequests: 0,
        currentLoad: 0,
        averageResponseTime: 0,
        lastUpdateTime: Date.now(),
      });
    }
  }

  private startMetricsCollection(): void {
    const updateMetrics = () => {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      const fiveSecondsAgo = now - 5000;

      // Keep a sliding window of requests
      const recentRequests = this.requestTimes.filter(
        (time) => time > fiveSecondsAgo,
      );
      const recentErrors = this.errorTimes.filter(
        (time) => time > fiveSecondsAgo,
      );

      // Calculate rates (requests per second)
      const windowSize = 5; // Fixed 5-second window
      this.metrics.requestRate = recentRequests.length / windowSize;
      this.metrics.errorRate = recentErrors.length / windowSize;
      this.metrics.currentLoad = this.activeRequests.size;
      this.metrics.averageResponseTime = this.calculateAverageResponseTime();

      // Update last minute stats using the full minute window
      const minuteRequests = this.requestTimes.filter(
        (time) => time > oneMinuteAgo,
      );
      const minuteErrors = this.errorTimes.filter(
        (time) => time > oneMinuteAgo,
      );
      this.metrics.lastMinuteStats = {
        totalRequests: minuteRequests.length,
        successfulRequests: minuteRequests.length - minuteErrors.length,
        failedRequests: minuteErrors.length,
      };

      // Clean up old times periodically
      if (now - this.lastMetricsUpdate >= 10000) {
        this.requestTimes = this.requestTimes.filter(
          (time) => time > oneMinuteAgo,
        );
        this.errorTimes = this.errorTimes.filter((time) => time > oneMinuteAgo);
      }

      // Emit metrics update
      this.emit("metrics", { ...this.metrics });
      this.lastMetricsUpdate = now;
    };

    // Update metrics frequently to ensure accurate rates under load
    updateMetrics();
    this.metricsInterval = setInterval(updateMetrics, 100);
  }

  private watchStateChanges(): void {
    this.stateStore.watchState(this.serviceKey, (stats) => {
      this.emit("stateUpdate", stats);
    });
  }

  private startHealthCheck(): void {
    const performHealthCheck = async (): Promise<void> => {
      try {
        const stats = await this.stateStore.getState(this.serviceKey);
        if (!stats) {
          return;
        }

        const now = Date.now();
        const lastFailureTime = stats.lastFailureTime ?? 0;

        // Check for state transition
        if (
          stats.state === CircuitBreakerState.OPEN &&
          now - lastFailureTime >= this.options.resetTimeout
        ) {
          // Force state update atomically
          const currentStats = await this.stateStore.getState(this.serviceKey);
          if (currentStats?.state === CircuitBreakerState.OPEN) {
            await this.transitionToHalfOpen();
            return; // Exit early after state transition
          }
        }

        // Update metrics
        const updatedStats = {
          ...stats,
          currentLoad: this.activeRequests.size,
          averageResponseTime: this.calculateAverageResponseTime(),
          lastMinuteRequests: this.requestTimes.length,
          lastUpdateTime: now,
        };
        await this.stateStore.setState(this.serviceKey, updatedStats);

        // Emit metrics update
        this.emit("healthCheck", updatedStats);
      } catch (error) {
        console.error("Health check failed:", error);
      }
    };

    // Run health check frequently enough to catch state transitions
    void performHealthCheck();
    this.healthCheckInterval = setInterval(
      () => {
        void performHealthCheck();
      },
      Math.min(this.options.monitorInterval, this.options.resetTimeout / 2),
    ); // Run at least twice during reset timeout
  }

  private calculateAverageResponseTime(): number {
    if (this.responseTimes.length === 0) {
      return 0;
    }
    // Only consider the last 100 response times for a more accurate recent average
    const recentTimes = this.responseTimes.slice(-100);
    return (
      recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length
    );
  }

  private async updateStats(
    stats: CircuitBreakerStats,
    updates: Partial<CircuitBreakerStats>,
  ): Promise<void> {
    const updatedStats = {
      ...stats,
      ...updates,
      lastUpdateTime: Date.now(),
    };
    await this.stateStore.setState(this.serviceKey, updatedStats);
  }

  private async transitionToHalfOpen(): Promise<void> {
    const stats = await this.stateStore.getState(this.serviceKey);
    if (!stats || stats.state !== CircuitBreakerState.OPEN) {
      return;
    }

    await this.updateStats(stats, {
      state: CircuitBreakerState.HALF_OPEN,
      failureCount: 0,
      failedRequests: stats.failedRequests,
    });

    this.emit("stateChange", {
      from: CircuitBreakerState.OPEN,
      to: CircuitBreakerState.HALF_OPEN,
    });
  }

  private async transitionToOpen(error: Error): Promise<void> {
    const stats = await this.stateStore.getState(this.serviceKey);
    if (!stats || stats.state === CircuitBreakerState.OPEN) {
      return;
    }

    await this.updateStats(stats, {
      state: CircuitBreakerState.OPEN,
      lastFailureTime: Date.now(),
      lastError: error.message,
      failureCount: this.options.failureThreshold,
    });

    this.emit("stateChange", {
      from: stats.state,
      to: CircuitBreakerState.OPEN,
    });
    this.emit("circuitOpen", { error });
  }

  private async transitionToClosed(): Promise<void> {
    const stats = await this.stateStore.getState(this.serviceKey);
    if (!stats || stats.state === CircuitBreakerState.CLOSED) {
      return;
    }

    await this.updateStats(stats, {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      failedRequests: 0,
      lastSuccessTime: Date.now(),
    });

    this.emit("stateChange", {
      from: stats.state,
      to: CircuitBreakerState.CLOSED,
    });
  }

  public async execute<T>(serviceCall: ServiceCall<T>): Promise<T> {
    let stats = await this.stateStore.getState(this.serviceKey);
    if (!stats) {
      await this.initializeState();
      stats = (await this.stateStore.getState(this.serviceKey))!;
    }

    // Check if circuit should transition from OPEN to HALF_OPEN
    if (stats.state === CircuitBreakerState.OPEN) {
      const now = Date.now();
      const lastFailureTime = stats.lastFailureTime ?? 0;
      if (now - lastFailureTime >= this.options.resetTimeout) {
        await this.transitionToHalfOpen();
        stats = (await this.stateStore.getState(this.serviceKey))!;
      } else {
        throw new Error("Circuit breaker is OPEN");
      }
    }

    // Check if max concurrent requests exceeded
    if (
      this.options.maxConcurrent !== undefined &&
      this.activeRequests.size >= this.options.maxConcurrent
    ) {
      throw new Error("Maximum concurrent requests exceeded");
    }

    // Create a unique request ID
    const requestId = Symbol("request");

    // Add to active requests before executing
    this.activeRequests.add(requestId);

    // Track request time
    const startTime = Date.now();
    this.requestTimes.push(startTime);

    // Create the request promise
    const request = (async () => {
      try {
        // Set up timeout if configured
        let timeoutId: NodeJS.Timeout | undefined;

        const timeoutPromise = new Promise<never>((_, reject) => {
          if (this.options.serviceTimeout > 0) {
            timeoutId = setTimeout(() => {
              reject(new Error("Service timeout"));
            }, this.options.serviceTimeout);
          }
        });

        // Execute the service call with timeout
        const result = await Promise.race([serviceCall(), timeoutPromise]);

        // Clear timeout if set
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Record successful response
        const responseTime = Date.now() - startTime;
        this.recordResponseTime(responseTime);

        // Update success stats
        await this.recordSuccess();

        // If in HALF_OPEN and successful, transition to CLOSED
        if (stats.state === CircuitBreakerState.HALF_OPEN) {
          await this.transitionToClosed();
        }

        return result;
      } catch (error) {
        // Record failure and potentially open circuit
        await this.recordFailure(error as Error);
        throw error;
      } finally {
        // Always clean up
        this.activeRequests.delete(requestId);

        // Update metrics
        this.emit("metrics", {
          requestRate: this.calculateRequestRate(),
          errorRate: this.calculateErrorRate(),
          averageResponseTime: this.calculateAverageResponseTime(),
          concurrentRequests: this.activeRequests.size,
        });
      }
    })();

    return request;
  }

  private recordResponseTime(responseTime: number): void {
    this.responseTimes.push(responseTime);
  }

  private async recordSuccess(): Promise<void> {
    const stats = await this.stateStore.getState(this.serviceKey);
    if (stats) {
      await this.updateStats(stats, {
        successfulRequests: (stats.successfulRequests ?? 0) + 1,
        totalRequests: (stats.totalRequests ?? 0) + 1,
        lastSuccessTime: Date.now(),
        averageResponseTime: this.calculateAverageResponseTime(),
        currentLoad: this.activeRequests.size,
      });
    }
  }

  private async recordFailure(error: Error): Promise<void> {
    const stats = await this.stateStore.getState(this.serviceKey);
    if (stats) {
      const failureCount = await this.stateStore.incrementFailureCount(
        this.serviceKey,
      );
      await this.updateStats(stats, {
        failedRequests: (stats.failedRequests ?? 0) + 1,
        totalRequests: (stats.totalRequests ?? 0) + 1,
        lastError: error.message,
        failureCount,
        lastFailureTime: Date.now(),
        averageResponseTime: this.calculateAverageResponseTime(),
        currentLoad: this.activeRequests.size,
      });

      // Emit failure event for each failure
      this.emit("failure", { error });

      if (
        stats.state === CircuitBreakerState.HALF_OPEN ||
        failureCount >= this.options.failureThreshold
      ) {
        await this.transitionToOpen(error);
      }
    }
  }

  private calculateRequestRate(): number {
    if (this.requestTimes.length === 0) {
      return 0;
    }
    // Only consider the last 100 request times for a more accurate recent average
    const recentTimes = this.requestTimes.slice(-100);
    return recentTimes.length / 5; // Fixed 5-second window
  }

  private calculateErrorRate(): number {
    if (this.errorTimes.length === 0) {
      return 0;
    }
    // Only consider the last 100 error times for a more accurate recent average
    const recentErrors = this.errorTimes.slice(-100);
    return recentErrors.length / 5; // Fixed 5-second window
  }

  public async getStats(): Promise<CircuitBreakerStats | null> {
    return this.stateStore.getState(this.serviceKey);
  }

  public getMetrics(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }

  public stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
