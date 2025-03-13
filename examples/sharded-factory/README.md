# Sharded Circuit Breaker Factory Example

This example demonstrates how to use the `ShardedCircuitBreakerFactory` to easily create and manage multiple services with sharded circuit breakers.

## Features

- Simple API for creating multiple sharded circuit breakers
- Fully type-safe event listener management
- Centralized service call execution
- Proper cleanup of resources
- Automatic shard selection based on keys
- Consistent hashing for load distribution

## Prerequisites

- Node.js 16+
- etcd running locally (default: http://localhost:2379)

## Running the Example

1. Make sure etcd is running:
   ```
   brew services start etcd
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the example:
   ```
   npm run build
   ```

4. Run the example:
   ```
   npm start
   ```

## How It Works

The `ShardedCircuitBreakerFactory` is the recommended way to implement sharding in GuardRail:

1. Create a factory with your state store and base options
2. Define your services with custom configurations and shard counts
3. Create circuit breakers for each service (the factory creates multiple instances internally)
4. Add type-safe event listeners for monitoring and state changes
5. Execute service calls through the factory with automatic shard selection
6. Clean up resources when done

## Sharding Implementation

The `ShardedCircuitBreakerFactory` handles all sharding functionality by:

1. Creating multiple `HighPerformanceCircuitBreaker` instances for each service
2. Using consistent hashing to distribute requests across shards
3. Managing the lifecycle of all circuit breaker instances
4. Providing a unified API for executing service calls

This approach simplifies the codebase by keeping sharding logic in one place and allowing the `HighPerformanceCircuitBreaker` to focus on its core functionality.

## Example Output

The example will:

1. Create circuit breakers for 4 services (payment, inventory, shipping, recommendation)
2. Each service will have 4 shards
3. Simulate service calls with targeted failures
4. Show how circuit breakers transition between states
5. Clean up all resources properly

## Code Example

```typescript
// Create the factory
const factory = new ShardedCircuitBreakerFactory(new EtcdStore('http://localhost:2379'), baseOptions);

// Create circuit breakers for a service
factory.createServiceBreakers({
  name: 'payment',
  shardCount: 4,
  options: { failureThreshold: 2 }
});

// Add type-safe event listeners
factory.addServiceListeners('payment', [
  {
    event: 'stateChange',
    listener: (stateChange) => {
      console.log(`State changed: ${stateChange.from} → ${stateChange.to}`);
    }
  }
]);

// Execute a service call with automatic shard selection
await factory.executeWithKey('payment', 'user-123', async () => {
  // Your service logic here
  return { success: true };
});

// Or execute with a specific shard
await factory.executeServiceCall('payment', 0, async () => {
  // Your service logic here
  return { success: true };
});

// Clean up when done
await factory.cleanup();
```

## Type Safety Improvements

The latest version includes several type safety enhancements:

1. **Type-Safe Event Handling**: Event listeners are now fully typed, providing proper type checking and autocompletion for event data
2. **StoredEventListener Type**: A dedicated type for stored event listeners ensures type consistency throughout the codebase
3. **Service Call Return Types**: Service calls now properly preserve the return type of the service function
4. **No More Type Casting**: Removed unsafe type casts for improved type safety

## Benefits of Using the Factory

- **Simplified Management**: Manage multiple services through a single interface
- **Reduced Boilerplate**: Avoid repetitive code for creating and configuring circuit breakers
- **Type Safety**: Get compile-time errors for incorrect event handling or service calls
- **Resource Management**: Automatic cleanup of all circuit breakers and event listeners
- **Consistent Configuration**: Apply base options to all services with the ability to override per service

## Additional Resources

For more information, refer to the main [GuardRail documentation](https://github.com/kaushiksamanta/guardrail).
