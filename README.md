# GuardRail

A high-performance distributed circuit breaker implementation for Node.js and TypeScript applications. This package helps prevent cascading failures in distributed systems by managing service health and implementing the circuit breaker pattern with support for high-throughput scenarios.

## Features

- High-performance implementation supporting 1M+ requests per minute
- Distributed state management using etcd with caching layer
- Sharding support for horizontal scaling through ShardedCircuitBreakerFactory
- Real-time metrics and monitoring
- Three circuit breaker states: CLOSED, OPEN, and HALF-OPEN
- Configurable failure thresholds and timeouts
- Event-driven state changes
- Health monitoring and automatic recovery
- Service timeout protection
- Fully type-safe TypeScript implementation
- Comprehensive test suite

## Installation

```bash
npm install guardrail etcd3
```

## Prerequisites

- Node.js (v14 or higher)
- etcd (v3.x) for distributed state management

## Basic Usage

```typescript
import { HighPerformanceCircuitBreaker, EtcdStateStore } from 'guardrail';

// Create a state store
const etcdStore = new EtcdStateStore({
  hosts: ['http://localhost:2379']
});

// Create a circuit breaker instance
const circuitBreaker = new HighPerformanceCircuitBreaker('my-service', etcdStore, {
  failureThreshold: 5,
  resetTimeout: 60000,      // 60 seconds
  serviceTimeout: 5000,     // 5 seconds
  maxConcurrent: 10000      // Max concurrent requests
});

// Subscribe to events
circuitBreaker.on('stateChange', ({ from, to }) => {
  console.log(`Circuit breaker state changed from ${from} to ${to}`);
});

circuitBreaker.on('metrics', (metrics) => {
  console.log('Current metrics:', metrics);
});

// Execute a service call
try {
  const result = await circuitBreaker.execute(async () => {
    const response = await fetch('https://api.example.com/data');
    return response.json();
  });
  console.log('Success:', result);
} catch (error) {
  console.error('Failed:', error);
}

// Get current metrics
const metrics = circuitBreaker.getMetrics();
console.log('Circuit breaker metrics:', metrics);

// Clean up when done
circuitBreaker.stop();
await etcdStore.close();
```

## Sharding Support

For high-throughput distributed scenarios, use the ShardedCircuitBreakerFactory which provides sharding capabilities:

```typescript
import { 
  ShardedCircuitBreakerFactory, 
  EtcdStateStore 
} from 'guardrail';

// Create store
const etcdStore = new EtcdStateStore({ hosts: ['http://localhost:2379'] });

// Create factory with base options
const factory = new ShardedCircuitBreakerFactory(etcdStore, {
  failureThreshold: 5,
  resetTimeout: 30000,
  serviceTimeout: 2000
});

// Create circuit breakers for a service with sharding
factory.createServiceBreakers({
  name: 'payment',
  shardCount: 4,  // Number of shards
  options: { failureThreshold: 3 }  // Override base options
});
```

Sharding distributes the load across multiple circuit breaker instances while maintaining consistent state through the distributed store.

## Using ShardedCircuitBreakerFactory

For managing multiple services with sharded circuit breakers, use the `ShardedCircuitBreakerFactory`:

```typescript
import { 
  ShardedCircuitBreakerFactory, 
  EtcdStateStore 
} from 'guardrail';

// Create store
const etcdStore = new EtcdStateStore({ hosts: ['http://localhost:2379'] });

// Create factory with base options
const factory = new ShardedCircuitBreakerFactory(etcdStore, {
  failureThreshold: 5,
  resetTimeout: 30000,
  serviceTimeout: 2000
});

// Create circuit breakers for multiple services
factory.createServiceBreakers({
  name: 'payment',
  shardCount: 4,
  options: { failureThreshold: 3 }  // Override base options
});

factory.createServiceBreakers({
  name: 'inventory',
  shardCount: 2
});

// Add event listeners
factory.addServiceListeners('payment', [
  {
    event: 'stateChange',
    listener: (stateChange) => {
      console.log(`Payment service state changed: ${stateChange.from} → ${stateChange.to}`);
    }
  }
]);

// Execute service calls with automatic shard selection
const result = await factory.executeWithKey('payment', 'user-123', async () => {
  // Service call implementation
  return { orderId: 'abc123' };
});

// Clean up when done
await factory.cleanup();
await etcdStore.close();
```

## Sharded Circuit Breaker Example

This section provides an example of how to implement a sharded circuit breaker in your application using the GuardRail library.

### Implementation

```typescript
import { CircuitBreaker, CircuitBreakerOptions } from 'guardrail';

// Define options for the sharded circuit breaker
const options: CircuitBreakerOptions = {
    failureThreshold: 0.5, // 50% failure rate to open the circuit
    timeout: 1000, // Timeout after 1 second
    // Additional options can be configured here
};

// Create a sharded circuit breaker instance
const circuitBreaker = new CircuitBreaker(options);

// Function to simulate a service call
async function serviceCall() {
    // Simulate a service call that may fail
    return Math.random() > 0.7 ? 'Success' : Promise.reject('Failure');
}

// Using the circuit breaker to wrap the service call
async function callService() {
    try {
        const result = await circuitBreaker.call(serviceCall);
        console.log(result);
    } catch (error) {
        console.error('Circuit breaker opened:', error);
    }
}

// Call the service multiple times to demonstrate sharding
for (let i = 0; i < 10; i++) {
    callService();
}
```

### Explanation
- **CircuitBreaker**: This is the main class used to create a circuit breaker instance.
- **Options**: You can configure various options like `failureThreshold` and `timeout` to control the behavior of the circuit breaker.
- **Service Call**: The `serviceCall` function simulates a service that may succeed or fail randomly.
- **Using the Circuit Breaker**: The `callService` function demonstrates how to use the circuit breaker to wrap service calls and handle errors gracefully.

This example illustrates how to implement a sharded circuit breaker in your application, allowing for better resilience and fault tolerance in distributed systems.

## Example Projects

The repository includes three example implementations that demonstrate GuardRail's capabilities in different contexts:

### Basic Usage Example

This example illustrates the core functionality of the circuit breaker pattern in a standalone application:

- Implements a single circuit breaker instance with etcd state persistence
- Demonstrates state transitions between CLOSED, OPEN, and HALF-OPEN
- Simulates service failures with configurable error rates
- Shows recovery behavior after the reset timeout period
- Provides console-based monitoring of circuit state changes

The basic example is ideal for developers new to circuit breakers or those wanting to understand GuardRail's implementation details.

### API Gateway Example

This example demonstrates GuardRail's application in a microservices architecture:

- Implements an Express.js API gateway with circuit breakers for multiple downstream services
- Creates circuit breakers dynamically based on service endpoints
- Provides HTTP endpoints for monitoring circuit breaker states
- Implements proper error handling with appropriate status codes
- Demonstrates resource management with graceful shutdown
- Includes structured logging with Winston

The API gateway example showcases how GuardRail can be integrated into production systems to protect downstream services from cascading failures.

### Sharded Circuit Breaker Example

This project demonstrates how to implement a sharded circuit breaker using the GuardRail library, showcasing its resilience and fault tolerance in distributed systems. See the [Sharded Circuit Breaker Example](#sharded-circuit-breaker-example) for implementation details.

### Implementation Differences

| Feature | Basic Example | API Gateway Example | Sharded Circuit Breaker Example |
|---------|---------------|---------------------|--------------------------------|
| Architecture | Single service | Multiple microservices | Multiple sharded services |
| Integration | Command-line application | HTTP web server | Centralized factory |
| Circuit Breakers | Single, static instance | Multiple, dynamically created | Multiple, sharded instances |
| Monitoring | Console output | Dedicated HTTP endpoint | Event-based monitoring |
| Error Handling | Basic try/catch | HTTP status codes | Type-safe result objects |
| Logging | Console output | Structured logging | Event-driven logging |

### Running the Examples

```bash
# Basic Usage Example
cd examples/basic-usage
npm install
npm start

# API Gateway Example
cd examples/api-gateway
npm install
npm start

# Sharded Factory Example
cd examples/sharded-factory-example
npm install
npm start
```

For more details, refer to the README files in each example directory.

## Recent Improvements

- **Enhanced Type Safety**: All components now have full TypeScript type safety with no use of `any` types
- **Centralized Type Definitions**: All types are now defined in a central `types.ts` file for better maintainability
- **Improved ShardedCircuitBreakerFactory**: Added type-safe event handling and better resource management
- **Better Error Handling**: More descriptive error messages and proper error typing
- **Performance Optimizations**: Reduced memory usage and improved concurrent request handling
- **Comprehensive Documentation**: Updated examples and API documentation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.