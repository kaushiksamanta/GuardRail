# GuardRail API Gateway Example

This example demonstrates how to use GuardRail in an API Gateway scenario to protect downstream services from cascading failures.

## Features

- Express-based API Gateway
- Circuit breakers for multiple backend services
- Distributed circuit breaker state using etcd
- Local caching for improved performance
- Health check and circuit status endpoints
- Fully type-safe circuit breaker implementation
- Comprehensive error handling

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

## Testing the API Gateway

Once the API Gateway is running, you can test it with the following endpoints:

### Get all users
```
GET http://localhost:3000/api/users
```

### Get a specific user
```
GET http://localhost:3000/api/users/1
```

### Get all posts
```
GET http://localhost:3000/api/posts
```

### Get a specific post
```
GET http://localhost:3000/api/posts/1
```

### Check circuit breaker status
```
GET http://localhost:3000/circuit-status
```

### Health check
```
GET http://localhost:3000/health
```

## How It Works

1. The API Gateway creates a circuit breaker for each downstream service
2. When a request comes in, the gateway checks if the circuit is closed (allowing requests)
3. If closed, it forwards the request to the appropriate service
4. It reports success or failure to the circuit breaker based on the response
5. If the circuit is open, it immediately returns a 503 error without making the downstream request

This pattern prevents cascading failures by quickly failing requests to services that are experiencing high error rates, giving them time to recover.

## Type Safety Improvements

The latest version of GuardRail includes enhanced type safety features that benefit this API Gateway example:

1. **Type-Safe Event Handling**: All event listeners are properly typed, providing autocompletion and type checking for event data
2. **Improved Error Types**: Specific error types for different failure scenarios
3. **No Any Types**: Eliminated usage of `any` types throughout the codebase

## Error Handling

The API Gateway demonstrates proper error handling with HTTP status codes:

- **503 Service Unavailable**: When a circuit is open, indicating the service is temporarily unavailable
- **504 Gateway Timeout**: When a service call times out
- **500 Internal Server Error**: For other service failures
- **404 Not Found**: When a requested resource doesn't exist

Example error response:

```json
{
  "error": "Service Unavailable",
  "message": "The users service is currently unavailable. Please try again later.",
  "circuitState": "OPEN",
  "retryAfter": 30
}
```

## Customizing the Example

You can modify the circuit breaker configuration in `src/index.ts` to experiment with different settings for each service.

## Additional Resources

For more information, refer to the main [GuardRail documentation](https://github.com/kaushiksamanta/guardrail).
