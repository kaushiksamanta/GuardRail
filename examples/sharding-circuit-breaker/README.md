# GuardRail Sharding Circuit Breaker Example

This example demonstrates how to use the GuardRail library with the `HighPerformanceCircuitBreaker` for high-throughput scenarios.

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

1. How to configure a `HighPerformanceCircuitBreaker` for high-throughput scenarios
2. How to handle a large number of concurrent requests
3. How to monitor circuit breaker metrics and state changes
4. How to properly clean up resources when done

## Note About Sharding

This example demonstrates a single circuit breaker instance. For distributed scenarios with sharding support, please refer to the `sharded-factory` example which shows how to use the `ShardedCircuitBreakerFactory` to create and manage multiple circuit breaker instances (shards) for a service.

## Customizing the Example

You can modify the following parameters in the `src/index.ts` file:

- `failureThreshold`: Number of failures before opening the circuit
- `resetTimeout`: Time in milliseconds before attempting to half-open the circuit
- `serviceTimeout`: Timeout for service requests in milliseconds
- `maxConcurrent`: Maximum number of concurrent requests
- `halfOpenRetryLimit`: Number of requests to try when half-open
- `monitorInterval`: Health check interval in milliseconds
