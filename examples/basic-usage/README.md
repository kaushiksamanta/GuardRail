# GuardRail Basic Usage Example

This example demonstrates how to use the GuardRail library to implement a circuit breaker pattern in your application.

## Prerequisites

- Node.js (>=14.0.0)
- npm or yarn
- etcd running locally (or update the connection string in the example)

## Running etcd locally

You can run etcd locally using Docker:

```bash
docker run -d -p 2379:2379 -p 2380:2380 --name etcd quay.io/coreos/etcd:v3.5.0 /usr/local/bin/etcd --advertise-client-urls http://0.0.0.0:2379 --listen-client-urls http://0.0.0.0:2379
```

## Installation

1. Install dependencies:

```bash
npm install
```

2. Build the example:

```bash
npm run build
```

## Running the Example

```bash
npm start
```

## What This Example Demonstrates

This example shows:

1. How to configure a `HighPerformanceCircuitBreaker` with an `EtcdStateStore`
2. How to check if a request is allowed using `isAllowed()`
3. How to report successes and failures
4. How the circuit breaker transitions between states based on the failure rate
5. How to use the fully type-safe API for event handling and service execution

The example simulates a service with a 30% failure rate and shows how the circuit breaker opens after enough failures, preventing further requests for a period of time.

## Customizing the Example

You can modify the following parameters in the `src/index.ts` file:

- `failureThreshold`: Number of failures before opening the circuit
- `resetTimeout`: Time in milliseconds before attempting to half-open the circuit
- `serviceTimeout`: Timeout for service requests in milliseconds
- `maxConcurrent`: Maximum number of concurrent requests

For distributed scenarios with sharding support, check the sharded-factory example which demonstrates how to use the `ShardedCircuitBreakerFactory`.

## Type Safety Features

The latest version of GuardRail includes enhanced type safety features:

1. **Fully Typed Event Handling**: All event listeners are properly typed, providing autocompletion and type checking for event data
2. **Type-Safe Service Calls**: The `execute()` method preserves the return type of your service function
3. **Improved Error Types**: Error handling with proper TypeScript types for better error management
4. **No Any Types**: Eliminated usage of `any` types throughout the codebase

## Error Handling

GuardRail provides comprehensive error handling with specific error types:

- `CircuitOpenError`: Thrown when a request is rejected due to an open circuit
- `ServiceTimeoutError`: Thrown when a service call exceeds the configured timeout
- `ServiceExecutionError`: Wraps errors thrown by the service itself

Example of handling specific error types:

```typescript
try {
  const result = await circuitBreaker.execute(async () => {
    // Service call
    return await fetchData();
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log('Circuit is open, service is unavailable');
  } else if (error instanceof ServiceTimeoutError) {
    console.log('Service call timed out');
  } else {
    console.log('Service execution failed:', error);
  }
}
```

## Additional Resources

For more information, refer to the main [GuardRail documentation](https://github.com/kaushiksamanta/guardrail).
