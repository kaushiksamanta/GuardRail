import { HighPerformanceCircuitBreaker, EtcdStateStore, CircuitBreakerOptions, CircuitBreakerState } from "guardrail";
import { EventEmitter } from "events";

// Configuration for the circuit breakers
const baseOptions: CircuitBreakerOptions = {
    failureThreshold: 3,
    resetTimeout: 2000,
    serviceTimeout: 1000,
    maxConcurrent: 10000,
    halfOpenRetryLimit: 1,
    monitorInterval: 5000,
};

// Create an instance of EtcdStateStore with the specified hosts
const etcdStore = new EtcdStateStore({
    hosts: ['http://localhost:2379']
    // Note: keyPrefix is not supported in the current API
});

// Define our services
const SERVICES = ['payment', 'inventory', 'shipping', 'recommendation'];
const SHARD_COUNT = 4;

console.log("🔌 Multi-Service Circuit Breaker Demo");
console.log(`🔄 Creating circuit breakers for ${SERVICES.length} services with ${SHARD_COUNT} shards each...`);

// Create circuit breakers for each service
const serviceBreakers: Record<string, HighPerformanceCircuitBreaker[]> = {};

// Create sharded circuit breakers for each service
SERVICES.forEach(service => {
    // Each service can have its own configuration
    const serviceOptions = { ...baseOptions };
    
    // Customize options per service (example: payment is more sensitive)
    if (service === 'payment') {
        serviceOptions.failureThreshold = 2; // Lower threshold for payment
    } else if (service === 'recommendation') {
        serviceOptions.failureThreshold = 5; // Higher threshold for recommendations
    }
    
    console.log(`📌 Creating circuit breaker for ${service} service with threshold: ${serviceOptions.failureThreshold}`);
    
    // Create array of circuit breakers (shards) for this service
    serviceBreakers[service] = Array(SHARD_COUNT)
        .fill(null)
        .map((_, i) => new HighPerformanceCircuitBreaker(`${service}-${i}`, etcdStore, serviceOptions));
});

// Keep track of all event listeners for proper cleanup
const allListeners: Record<string, Array<{ event: string, listener: (...args: any[]) => void }>> = {};

// Track states for each service and shard
const serviceStates: Record<string, Record<number, CircuitBreakerState>> = {};
SERVICES.forEach(service => {
    serviceStates[service] = {};
    for (let i = 0; i < SHARD_COUNT; i++) {
        serviceStates[service][i] = CircuitBreakerState.CLOSED;
    }
});

// Set up listeners for all circuit breakers
SERVICES.forEach(service => {
    allListeners[service] = [];
    
    serviceBreakers[service].forEach((breaker, shardId) => {
        // Metrics listener
        const metricListener = (metrics: any) => {
            console.log(`📊 ${service.toUpperCase()} Shard ${shardId} metrics:`, metrics);
        };
        breaker.on('metrics', metricListener);
        allListeners[service].push({ event: 'metrics', listener: metricListener });
        
        // State change listener
        const stateListener = (stateChange: any) => {
            const { from, to } = stateChange;
            serviceStates[service][shardId] = to;
            
            console.log(`🔄 ${service.toUpperCase()} Shard ${shardId} state changed: ${from} → ${to}`);
            
            // Log more detailed information based on the state
            if (to === CircuitBreakerState.OPEN) {
                console.log(`⚠️ Circuit OPEN for ${service.toUpperCase()} Shard ${shardId}: Service calls will fail fast until reset timeout`);
            } else if (to === CircuitBreakerState.HALF_OPEN) {
                console.log(`🔍 Circuit HALF-OPEN for ${service.toUpperCase()} Shard ${shardId}: Testing with limited traffic`);
            } else if (to === CircuitBreakerState.CLOSED) {
                console.log(`✅ Circuit CLOSED for ${service.toUpperCase()} Shard ${shardId}: Service operating normally`);
            }
        };
        breaker.on('stateChange', stateListener);
        allListeners[service].push({ event: 'stateChange', listener: stateListener });
        
        // Failure listener
        const failureListener = (failure: any) => {
            console.log(`❌ ${service.toUpperCase()} Shard ${shardId} failure detected:`, failure.error.message);
        };
        breaker.on('failure', failureListener);
        allListeners[service].push({ event: 'failure', listener: failureListener });
    });
});

// Simulate a service call with a specific service and shard
async function callService(
    service: string, 
    shardId: number, 
    forceFailure = false,
    simulatedLatency = 300
) {
    const breaker = serviceBreakers[service][shardId];
    
    try {
        console.log(`🔄 Calling ${service.toUpperCase()} service on Shard ${shardId}...`);
        
        // Get current state
        const state = serviceStates[service][shardId] || CircuitBreakerState.CLOSED;
        console.log(`ℹ️ Current circuit state: ${state}`);
        
        // Execute the service call through the circuit breaker
        await breaker.execute(async () => {
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, Math.random() * simulatedLatency));
            
            // Simulate success or failure
            const shouldFail = forceFailure || Math.random() < 0.3; // 30% chance to fail or forced failure
            if (shouldFail) {
                console.log(`⚠️ Simulating a failure in ${service.toUpperCase()} Shard ${shardId}...`);
                throw new Error(`${service.toUpperCase()} service failure on Shard ${shardId}`);
            }
            console.log(`✅ ${service.toUpperCase()} service call succeeded on Shard ${shardId}`);
        });
        
        return true; // Success
    } catch (error) {
        if (error instanceof Error && error.message.includes('Circuit breaker is OPEN')) {
            console.log(`🛑 Fast fail: Circuit is OPEN for ${service.toUpperCase()} Shard ${shardId}`);
        } else {
            console.error(`❌ Error calling ${service.toUpperCase()} service on Shard ${shardId}:`, error);
        }
        return false; // Failure
    }
}

// Simulate multiple pods making requests to different services
async function simulateMultiPodRequests(numRequests: number) {
    console.log(`\n🚀 Starting simulation of ${numRequests} requests across multiple services...`);
    
    // Track failures per service and shard
    const failures: Record<string, Record<number, number>> = {};
    SERVICES.forEach(service => {
        failures[service] = {};
        for (let i = 0; i < SHARD_COUNT; i++) {
            failures[service][i] = 0;
        }
    });
    
    // Target specific service-shard combinations for failures to demonstrate circuit opening
    const targetedFailures = [
        { service: 'payment', shard: 2 },
        { service: 'shipping', shard: 1 }
    ];
    
    console.log(`🎯 Targeting specific service-shards with failures to demonstrate circuit opening:`);
    targetedFailures.forEach(target => {
        console.log(`   - ${target.service.toUpperCase()} Shard ${target.shard}`);
    });
    
    // Simulate 4 pods making requests
    for (let i = 0; i < numRequests; i++) {
        try {
            // Simulate which pod is making the request
            const podId = i % 4;
            console.log(`\n📝 Request ${i + 1}/${numRequests} from Pod ${podId}:`);
            
            // Every 3rd request targets a specific service-shard for failure
            const useTargetedFailure = i % 3 === 0;
            
            let service: string;
            let shardId: number;
            let forceFailure = false;
            
            if (useTargetedFailure) {
                // Pick one of our targeted service-shards
                const target = targetedFailures[i % targetedFailures.length];
                service = target.service;
                shardId = target.shard;
                
                // Only force failure if we haven't reached the threshold yet
                const serviceOptions = service === 'payment' ? 
                    { ...baseOptions, failureThreshold: 2 } : 
                    (service === 'recommendation' ? { ...baseOptions, failureThreshold: 5 } : baseOptions);
                    
                const threshold = serviceOptions.failureThreshold;
                forceFailure = failures[service][shardId] < threshold;
                
                console.log(`🎯 Targeting ${service.toUpperCase()} Shard ${shardId} from Pod ${podId} (forced failure: ${forceFailure})`);
            } else {
                // Random service and shard
                service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
                shardId = Math.floor(Math.random() * SHARD_COUNT);
                console.log(`🔀 Random selection: ${service.toUpperCase()} Shard ${shardId} from Pod ${podId}`);
            }
            
            // Make the service call
            const success = await callService(service, shardId, forceFailure);
            
            // Track failures
            if (!success) {
                failures[service][shardId]++;
                
                // Get the appropriate threshold for this service
                let threshold = baseOptions.failureThreshold;
                if (service === 'payment') threshold = 2;
                if (service === 'recommendation') threshold = 5;
                
                console.log(`📈 ${service.toUpperCase()} Shard ${shardId} failure count: ${failures[service][shardId]}/${threshold}`);
                
                if (failures[service][shardId] >= threshold) {
                    console.log(`⚠️ Failure threshold reached for ${service.toUpperCase()} Shard ${shardId}!`);
                }
            }
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error(`❌ Request ${i + 1} processing error:`, error);
        }
    }
    
    // Print final failure counts
    console.log("\n📊 Final failure counts:");
    SERVICES.forEach(service => {
        console.log(`${service.toUpperCase()} service:`);
        for (let i = 0; i < SHARD_COUNT; i++) {
            console.log(`  Shard ${i}: ${failures[service][i]} failures`);
        }
    });
    
    // Print final circuit states
    console.log("\n📝 Final circuit states:");
    SERVICES.forEach(service => {
        console.log(`${service.toUpperCase()} service:`);
        for (let i = 0; i < SHARD_COUNT; i++) {
            console.log(`  Shard ${i}: ${serviceStates[service][i]}`);
        }
    });
}

// Clean up all resources properly
async function cleanUp() {
    console.log("\n🧹 Cleaning up resources...");
    
    // Remove all event listeners from circuit breakers
    SERVICES.forEach(service => {
        serviceBreakers[service].forEach((breaker, i) => {
            // Remove registered listeners
            allListeners[service].forEach(({ event, listener }) => {
                // Cast to any to avoid TypeScript errors
                breaker.removeListener(event, listener as any);
            });
            
            // Stop each breaker (which clears intervals)
            breaker.stop();
            
            // Remove all listeners (in case there are any we missed)
            (breaker as unknown as EventEmitter).removeAllListeners();
        });
    });
    
    // Close the state store (which closes the etcd connection)
    await etcdStore.close();
    
    // Remove any global event listeners
    process.removeAllListeners();
    
    console.log("✅ Cleanup completed.");
    
    // We need to force exit because etcd watchers might still be active
    // This is a known limitation of the etcd3 library
    console.log("👋 Forcing process exit due to etcd watchers");
    process.exit(0);
}

// Handle process signals for graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT. Cleaning up and exiting...');
    await cleanUp();
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM. Cleaning up and exiting...');
    await cleanUp();
});

// Main function to orchestrate the example
async function main() {
    console.log("🚀 Starting multi-service circuit breaker example...");
    try {
        // Demonstrate circuit breaker state transitions across multiple services
        await simulateMultiPodRequests(20);
        
        console.log("\n✅ Simulation completed!");
        
        // Wait a bit to see if circuits reset
        console.log(`⏱️ Waiting ${baseOptions.resetTimeout}ms to observe circuit reset...`);
        await new Promise(resolve => setTimeout(resolve, baseOptions.resetTimeout + 500));
        
        // Print final circuit states after waiting
        console.log("\n📝 Final circuit states after waiting:");
        SERVICES.forEach(service => {
            console.log(`${service.toUpperCase()} service:`);
            for (let i = 0; i < SHARD_COUNT; i++) {
                console.log(`  Shard ${i}: ${serviceStates[service][i]}`);
            }
        });
    } finally {
        // Always clean up resources, even if an error occurs
        await cleanUp();
    }
}

// Run the main function
main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});
