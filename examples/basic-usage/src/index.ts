import { HighPerformanceCircuitBreaker, EtcdStateStore } from 'guardrail';

// Create an etcd state store
const stateStore = new EtcdStateStore({
  hosts: ['localhost:2379']
});

// Example configuration for the circuit breaker
const circuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds in open state before trying half-open
  halfOpenRetryLimit: 5, // Allow 5 requests in half-open state
  monitorInterval: 60000, // 1 minute monitoring interval
  serviceTimeout: 5000, // 5 seconds timeout for service calls
  maxConcurrent: 1000 // Maximum concurrent requests
};

// Create a circuit breaker instance
const circuitBreaker = new HighPerformanceCircuitBreaker(
  'example-service', 
  stateStore, 
  circuitBreakerOptions
);

// Example function that might fail
async function exampleServiceCall(): Promise<string> {
  // Simulate a random failure
  if (Math.random() < 0.3) {
    throw new Error('Service call failed');
  }
  return 'Service call succeeded';
}

// Example of using the circuit breaker
async function main() {
  console.log('Starting circuit breaker example...');

  // Run multiple requests to demonstrate circuit breaker behavior
  for (let i = 0; i < 30; i++) {
    try {
      // Use the circuit breaker to execute the service call
      const result = await circuitBreaker.execute(async () => {
        return await exampleServiceCall();
      });
      
      console.log(`Request ${i + 1}: ${result}`);
    } catch (error) {
      console.error(`Request ${i + 1}: Failed - ${(error as Error).message}`);
    }

    // Add a small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Clean up resources
  await stateStore.close();
  console.log('Example completed.');
}

// Run the example
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
