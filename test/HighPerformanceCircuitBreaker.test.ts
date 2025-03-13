import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HighPerformanceCircuitBreaker } from "../src/HighPerformanceCircuitBreaker";
import { InMemoryStateStore, CircuitBreakerState } from "./utils/InMemoryStateStore";

describe("HighPerformanceCircuitBreaker", () => {
  let stateStore: InMemoryStateStore;
  let breaker: HighPerformanceCircuitBreaker;
  const serviceKey = "test-service";

  beforeEach(() => {
    stateStore = new InMemoryStateStore();
    breaker = new HighPerformanceCircuitBreaker(serviceKey, stateStore, {
      failureThreshold: 3,
      resetTimeout: 1000,
      serviceTimeout: 500,
      maxConcurrent: 1000,
    });
  });

  afterEach(async () => {
    breaker.stop();
    await stateStore.close();
  });

  describe("Circuit State Management", () => {
    it("should handle successful requests", async () => {
      const result = await breaker.execute(async (): Promise<string> => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        return "success";
      });
      expect(result).toBe("success");

      const stats = await breaker.getStats();
      expect(stats?.state).toBe(CircuitBreakerState.CLOSED);
      expect(stats?.failureCount).toBe(0);
      expect(stats?.successfulRequests).toBe(1);
      expect(stats?.totalRequests).toBe(1);
    });

    it("should open circuit after consecutive failures", async () => {
      const stateChanges: CircuitBreakerState[] = [];
      const failureEvents: Error[] = [];
      const circuitOpenEvents: Error[] = [];

      breaker.on("stateChange", ({ to }: { to: CircuitBreakerState }): void => {
        stateChanges.push(to);
      });

      breaker.on("failure", ({ error }: { error: Error }): void => {
        failureEvents.push(error);
      });

      breaker.on("circuitOpen", ({ error }: { error: Error }): void => {
        circuitOpenEvents.push(error);
      });

      // Execute failures sequentially for deterministic behavior
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() =>
            Promise.reject(new Error(`Error ${i + 1}`)),
          );
        } catch (error) {
          expect((error as Error).message).toBe(`Error ${i + 1}`);
        }

        const stats = await breaker.getStats();
        expect(stats?.failureCount).toBe(i + 1);
        expect(stats?.failedRequests).toBe(i + 1);
        expect(stats?.totalRequests).toBe(i + 1);
        expect(stats?.state).toBe(
          i < 2 ? CircuitBreakerState.CLOSED : CircuitBreakerState.OPEN,
        );
      }

      expect(failureEvents.length).toBe(3);
      expect(circuitOpenEvents.length).toBe(1);
      expect(stateChanges).toEqual([CircuitBreakerState.OPEN]);

      // Verify circuit remains open
      await expect(
        breaker.execute(() => Promise.resolve("success")),
      ).rejects.toThrow("Circuit breaker is OPEN");
    });

    it("should handle state transitions correctly", async () => {
      const resetTimeout = 500;
      const testBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          failureThreshold: 3,
          resetTimeout,
          serviceTimeout: 100,
        },
      );

      // Initial state should be CLOSED
      let stats = await testBreaker.getStats();
      expect(stats?.state).toBe(CircuitBreakerState.CLOSED);

      // Generate failures to open circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          testBreaker.execute(() =>
            Promise.reject(new Error(`Failure ${i + 1}`)),
          ),
        ).rejects.toThrow(`Failure ${i + 1}`);

        stats = await testBreaker.getStats();
        expect(stats?.failureCount).toBe(i + 1);
        expect(stats?.failedRequests).toBe(i + 1);
        expect(stats?.totalRequests).toBe(i + 1);
      }

      // Verify OPEN state
      stats = await testBreaker.getStats();
      expect(stats?.state).toBe(CircuitBreakerState.OPEN);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, resetTimeout + 100));

      // Verify HALF_OPEN state
      stats = await testBreaker.getStats();
      expect(stats?.state).toBe(CircuitBreakerState.HALF_OPEN);

      // Successful request in HALF_OPEN should transition to CLOSED
      await testBreaker.execute(() => Promise.resolve("success"));
      stats = await testBreaker.getStats();
      expect(stats?.state).toBe(CircuitBreakerState.CLOSED);
      expect(stats?.failureCount).toBe(0);
      expect(stats?.failedRequests).toBe(0);

      testBreaker.stop();
    });

    it("should handle service timeouts correctly", async () => {
      const timeoutBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          failureThreshold: 3,
          resetTimeout: 500,
          serviceTimeout: 50,
        },
      );

      const slowCall = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Verify timeout causes failure
      await expect(timeoutBreaker.execute(slowCall)).rejects.toThrow(
        "Service timeout",
      );

      const stats = await timeoutBreaker.getStats();
      expect(stats?.failureCount).toBe(1);
      expect(stats?.failedRequests).toBe(1);
      expect(stats?.totalRequests).toBe(1);
      expect(stats?.lastError).toBe("Service timeout");

      timeoutBreaker.stop();
    });

    it("should handle concurrent requests within limits", async () => {
      const maxConcurrent = 5;
      const concurrentBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          maxConcurrent,
          serviceTimeout: 100,
        },
      );

      const delay = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      // Use Promise.allSettled instead of Promise.all to avoid unhandled rejections
      const requests = Array(maxConcurrent + 1)
        .fill(null)
        .map(() => concurrentBreaker.execute(() => delay(10)));

      const results = await Promise.allSettled(requests);
      const rejectedResults = results.filter((r) => r.status === "rejected");

      // Verify at least one request was rejected
      expect(rejectedResults.length).toBeGreaterThan(0);

      // Verify rejection reason
      const rejection = rejectedResults[0] as PromiseRejectedResult;
      expect(rejection.reason.message).toBe(
        "Maximum concurrent requests exceeded",
      );

      concurrentBreaker.stop();
    });

    it("should maintain accurate metrics", async () => {
      const metricsBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          failureThreshold: 3,
          serviceTimeout: 100,
        },
      );

      // Mix of successful and failed requests
      const successfulCalls = 3;
      const failedCalls = 2;

      // Execute successful calls first
      for (let i = 0; i < successfulCalls; i++) {
        await metricsBreaker.execute(() => Promise.resolve("success"));
      }

      // Then execute failed calls
      for (let i = 0; i < failedCalls; i++) {
        try {
          await metricsBreaker.execute(() =>
            Promise.reject(new Error("Failed")),
          );
        } catch (error) {
          // Expected
        }
      }

      const stats = await metricsBreaker.getStats();
      expect(stats?.totalRequests).toBe(successfulCalls + failedCalls);
      expect(stats?.successfulRequests).toBe(successfulCalls);
      expect(stats?.failedRequests).toBe(failedCalls);
      expect(stats?.averageResponseTime).toBeGreaterThanOrEqual(0);

      metricsBreaker.stop();
    });
  });

  describe("Concurrent Request Management", () => {
    it("should handle concurrent requests with proper load management", async () => {
      const maxConcurrent = 50;
      const requestDelay = 20; // Fixed delay for deterministic testing
      const testBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          maxConcurrent,
          serviceTimeout: 1000,
          failureThreshold: 3,
        },
      );

      try {
        const loadMetrics: number[] = [];
        let maxObservedLoad = 0;

        // Track load changes
        testBreaker.on(
          "requestStarted",
          ({ currentLoad }: { currentLoad: number }) => {
            loadMetrics.push(currentLoad);
            maxObservedLoad = Math.max(maxObservedLoad, currentLoad);
          },
        );

        // Test sequential batches with different sizes
        const batches = [
          { size: 20, delay: requestDelay }, // Normal load
          { size: maxConcurrent, delay: requestDelay }, // Max load
          { size: 10, delay: requestDelay }, // Cool down
        ];

        for (const batch of batches) {
          const requests = Array(batch.size)
            .fill(null)
            .map(() =>
              testBreaker.execute(async () => {
                await new Promise((resolve) =>
                  setTimeout(resolve, batch.delay),
                );
                return "success";
              }),
            );

          const results = await Promise.allSettled(requests);

          // Verify all requests in batch succeeded
          const successful = results.filter(
            (r) => r.status === "fulfilled",
          ).length;
          expect(successful).toBe(batch.size);

          // Allow metrics to stabilize
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        const stats = await testBreaker.getStats();
        const metrics = testBreaker.getMetrics();

        // Verify request handling
        expect(stats?.totalRequests).toBe(80); // Sum of all batch sizes
        expect(maxObservedLoad).toBeLessThanOrEqual(maxConcurrent);

        // Verify metrics
        expect(metrics.requestRate).toBeGreaterThan(0);
        expect(metrics.currentLoad).toBe(0);
        expect(metrics.lastMinuteStats.successfulRequests).toBe(80);
        expect(metrics.lastMinuteStats.failedRequests).toBe(0);

        // Test overload rejection
        const overloadRequests = Array(maxConcurrent + 1)
          .fill(null)
          .map(() =>
            testBreaker.execute(async () => {
              await new Promise((resolve) => setTimeout(resolve, requestDelay));
              return "success";
            }),
          );

        const overloadResults = await Promise.allSettled(overloadRequests);
        const rejectedCount = overloadResults.filter(
          (r) => r.status === "rejected",
        ).length;
        expect(rejectedCount).toBeGreaterThan(0);

        // Verify rejection messages
        const rejection = overloadResults.find(
          (r) => r.status === "rejected",
        ) as PromiseRejectedResult;
        expect(rejection.reason.message).toBe(
          "Maximum concurrent requests exceeded",
        );
      } finally {
        testBreaker.stop();
      }
    }, 10000);

    it("should enforce max concurrent requests", async () => {
      const maxConcurrent = 10;
      const totalRequests = maxConcurrent + 5;
      const localBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          maxConcurrent,
          serviceTimeout: 500,
        },
      );

      const slowCall = async (): Promise<void> => {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      };

      // Execute requests in parallel with proper error handling
      const requests = Array(totalRequests)
        .fill(null)
        .map(() => {
          return localBreaker.execute(slowCall).catch((error) => {
            // Catch the error but return a rejected promise to maintain the rejection status
            // This prevents unhandled rejections while still allowing us to test for rejections
            if (error.message === "Maximum concurrent requests exceeded") {
              return Promise.reject(error);
            }
            return Promise.reject(error);
          });
        });

      const results = await Promise.allSettled(requests);

      // Verify rejections
      const rejected = results.filter((r) => r.status === "rejected").length;
      expect(rejected).toBe(totalRequests - maxConcurrent);

      // Verify rejection reason
      const rejectedResult = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      expect(rejectedResult?.reason.message).toBe(
        "Maximum concurrent requests exceeded",
      );

      // Verify metrics
      const metrics = localBreaker.getMetrics();
      expect(metrics.currentLoad).toBeLessThanOrEqual(maxConcurrent);

      // Clean up
      localBreaker.stop();
    }, 2000); // Increase timeout
  });

  describe("Error Handling", () => {
    it("should handle timeouts correctly", async () => {
      const serviceTimeout = 50;
      const timeoutBreaker = new HighPerformanceCircuitBreaker(
        serviceKey,
        stateStore,
        {
          serviceTimeout,
          failureThreshold: 1,
        },
      );

      try {
        const slowCall = async (): Promise<void> => {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, serviceTimeout * 2),
          );
        };

        await expect(timeoutBreaker.execute(slowCall)).rejects.toThrow(
          "Service timeout",
        );

        // Verify timeout affects circuit state
        const stats = await timeoutBreaker.getStats();
        expect(stats?.state).toBe(CircuitBreakerState.OPEN);
        expect(stats?.failureCount).toBe(1);
      } finally {
        timeoutBreaker.stop();
      }
    });

    it("should handle service errors gracefully", async () => {
      const errorTypes = ["network", "validation", "server"];
      const circuitOpenEvents: Error[] = [];
      const failureThreshold = 3;

      breaker.on("circuitOpen", ({ error }: { error: Error }): void => {
        circuitOpenEvents.push(error);
      });

      // Execute errors until circuit opens
      for (const errorType of errorTypes) {
        try {
          await breaker.execute(
            (): Promise<never> => Promise.reject(new Error(errorType)),
          );
        } catch (error) {
          expect((error as Error).message).toBe(errorType);
        }

        // Get stats after each error
        const currentStats = await breaker.getStats();

        // Once circuit opens, no more failures should be counted
        if (currentStats?.state === CircuitBreakerState.OPEN) {
          expect(currentStats.failureCount).toBe(failureThreshold);
          expect(currentStats.failedRequests).toBe(failureThreshold);
          break;
        }
      }

      // Verify final state
      const stats = await breaker.getStats();
      expect(stats?.state).toBe(CircuitBreakerState.OPEN);
      expect(stats?.failureCount).toBe(failureThreshold);
      expect(stats?.failedRequests).toBe(failureThreshold);

      // Verify circuit open events
      expect(circuitOpenEvents.length).toBe(1);
      expect(errorTypes).toContain(circuitOpenEvents[0].message);
    });
  });
});
