import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShardedCircuitBreakerFactory } from "../src/ShardedCircuitBreakerFactory";
import { InMemoryStateStore, CircuitBreakerState } from "./utils/InMemoryStateStore";

describe("ShardedCircuitBreakerFactory", () => {
  let stateStore: InMemoryStateStore;
  let factory: ShardedCircuitBreakerFactory;

  beforeEach(() => {
    stateStore = new InMemoryStateStore();
    factory = new ShardedCircuitBreakerFactory(stateStore, {
      failureThreshold: 3,
      resetTimeout: 1000,
      serviceTimeout: 500,
      halfOpenRetryLimit: 2,
      monitorInterval: 1000,
      maxConcurrent: 1000,
    });
  });

  afterEach(async () => {
    await factory.cleanup();
    await stateStore.close();
  });

  describe("Service Creation and Management", () => {
    it("should create circuit breakers for a service", () => {
      const breakers = factory.createServiceBreakers({
        name: "payment",
        shardCount: 4,
      });

      expect(breakers).toHaveLength(4);
      expect(factory.hasService("payment")).toBe(true);
      expect(factory.getServices()).toContain("payment");
    });

    it("should throw error when creating a service that already exists", () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 2,
      });

      expect(() => {
        factory.createServiceBreakers({
          name: "payment",
          shardCount: 3,
        });
      }).toThrow('Service "payment" already exists');
    });

    it("should get service breakers", () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 3,
      });

      const breakers = factory.getServiceBreakers("payment");
      expect(breakers).toHaveLength(3);
    });

    it("should throw error when getting breakers for non-existent service", () => {
      expect(() => {
        factory.getServiceBreakers("non-existent");
      }).toThrow('Service "non-existent" not found');
    });

    it("should get a specific service breaker by shard ID", () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 3,
      });

      const breaker = factory.getServiceBreaker("payment", 1);
      expect(breaker).toBeDefined();
    });

    it("should throw error when getting a breaker with invalid shard ID", () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 3,
      });

      expect(() => {
        factory.getServiceBreaker("payment", 5);
      }).toThrow("Invalid shard ID");
    });

    it("should get service configuration", () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 3,
        options: { failureThreshold: 5 },
      });

      const config = factory.getServiceConfig("payment");
      expect(config.name).toBe("payment");
      expect(config.shardCount).toBe(3);
      expect(config.options?.failureThreshold).toBe(5);
    });

    it("should throw error when getting config for non-existent service", () => {
      expect(() => {
        factory.getServiceConfig("non-existent");
      }).toThrow('Service "non-existent" not found');
    });

    it("should get all registered services", () => {
      factory.createServiceBreakers({ name: "payment", shardCount: 2 });
      factory.createServiceBreakers({ name: "inventory", shardCount: 3 });
      factory.createServiceBreakers({ name: "shipping", shardCount: 1 });

      const services = factory.getServices();
      expect(services).toHaveLength(3);
      expect(services).toContain("payment");
      expect(services).toContain("inventory");
      expect(services).toContain("shipping");
    });

    it("should check if a service exists", () => {
      factory.createServiceBreakers({ name: "payment", shardCount: 2 });

      expect(factory.hasService("payment")).toBe(true);
      expect(factory.hasService("non-existent")).toBe(false);
    });
  });

  describe("Event Listeners", () => {
    it("should add event listeners to all breakers for a service", () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 2,
      });

      const stateChangeListener = vi.fn();
      const metricsListener = vi.fn();

      factory.addServiceListeners("payment", [
        {
          event: "stateChange",
          listener: stateChangeListener,
        },
        {
          event: "metrics",
          listener: metricsListener,
        },
      ]);

      // Verify listeners were added by checking internal state
      // This is an implementation detail, but useful for testing
      expect(factory["eventListeners"]["payment"]).toHaveLength(2);
    });

    it("should throw error when adding listeners to non-existent service", () => {
      expect(() => {
        factory.addServiceListeners("non-existent", [
          {
            event: "stateChange",
            listener: () => {},
          },
        ]);
      }).toThrow('Service "non-existent" not found');
    });

    it("should properly clean up event listeners", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 2,
      });

      const stateChangeListener = vi.fn();
      factory.addServiceListeners("payment", [
        {
          event: "stateChange",
          listener: stateChangeListener,
        },
      ]);

      await factory.cleanup();
      
      // After cleanup, the event listeners should be removed
      expect(factory["eventListeners"]["payment"]).toBeUndefined();
    });
  });

  describe("Service State Management", () => {
    it("should get service state", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 2,
      });

      const state = await factory.getServiceState("payment", 0);
      expect(state).toBe(CircuitBreakerState.CLOSED);
    });

    it("should get states for all shards of a service", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 3,
      });

      const states = await factory.getServiceStates("payment");
      expect(Object.keys(states)).toHaveLength(3);
      expect(states[0]).toBe(CircuitBreakerState.CLOSED);
      expect(states[1]).toBe(CircuitBreakerState.CLOSED);
      expect(states[2]).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe("Service Call Execution", () => {
    it("should execute a service call successfully", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 2,
      });

      const result = await factory.executeServiceCall("payment", 0, async () => {
        return { id: "123", status: "success" };
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: "123", status: "success" });
      expect(result.service).toBe("payment");
      expect(result.shardId).toBe(0);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it("should handle service call failures", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 2,
      });

      const result = await factory.executeServiceCall("payment", 0, async () => {
        throw new Error("Service failed");
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Service failed");
      expect(result.service).toBe("payment");
      expect(result.shardId).toBe(0);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.circuitOpen).toBe(false);
    });

    it("should execute a service call with key-based shard selection", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 4,
      });

      // Spy on executeServiceCall to verify the shard selection
      const spy = vi.spyOn(factory, "executeServiceCall");

      await factory.executeWithKey("payment", "user-123", async () => {
        return { id: "123", status: "success" };
      });

      // Verify that executeServiceCall was called with the correct shard ID
      expect(spy).toHaveBeenCalled();
      
      // The shard ID is determined by the hashing function, so we can't predict it exactly
      // But we can verify that it's within the valid range
      const shardId = spy.mock.calls[0][1];
      expect(shardId).toBeGreaterThanOrEqual(0);
      expect(shardId).toBeLessThan(4);
    });

    it("should consistently map the same key to the same shard", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 4,
      });

      // Spy on executeServiceCall to verify the shard selection
      const spy = vi.spyOn(factory, "executeServiceCall");

      // Execute with the same key multiple times
      await factory.executeWithKey("payment", "user-123", async () => {
        return { id: "123", status: "success" };
      });

      const firstShardId = spy.mock.calls[0][1];
      spy.mockClear();

      await factory.executeWithKey("payment", "user-123", async () => {
        return { id: "123", status: "success" };
      });

      const secondShardId = spy.mock.calls[0][1];
      
      // The same key should map to the same shard
      expect(secondShardId).toBe(firstShardId);
    });

    it("should distribute different keys across shards", async () => {
      factory.createServiceBreakers({
        name: "payment",
        shardCount: 4,
      });

      // Create a map to track shard usage
      const shardUsage = new Map<number, number>();
      
      // Execute with 100 different keys
      for (let i = 0; i < 100; i++) {
        const result = await factory.executeWithKey("payment", `user-${i}`, async () => {
          return { success: true };
        });
        
        const { shardId } = result;
        shardUsage.set(shardId, (shardUsage.get(shardId) || 0) + 1);
      }
      
      // Verify that all shards were used
      expect(shardUsage.size).toBeGreaterThan(1);
      
      // Check that the distribution is somewhat even (not perfect, but reasonable)
      const counts = Array.from(shardUsage.values());
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      
      // The difference between min and max shouldn't be too extreme
      // This is a probabilistic test, but with 100 keys it should be reliable
      expect(max - min).toBeLessThan(50);
    });
  });

  describe("Cleanup", () => {
    it("should clean up all resources", async () => {
      factory.createServiceBreakers({ name: "payment", shardCount: 2 });
      factory.createServiceBreakers({ name: "inventory", shardCount: 3 });
      
      factory.addServiceListeners("payment", [
        {
          event: "stateChange",
          listener: () => {},
        },
      ]);

      await factory.cleanup();
      
      // After cleanup, the internal state should be cleared
      expect(factory["serviceBreakers"]).toEqual({});
      expect(factory["eventListeners"]).toEqual({});
      expect(factory["serviceConfigs"]).toEqual({});
    });
  });
});
