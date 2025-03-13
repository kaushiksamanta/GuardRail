import { 
  ShardedCircuitBreakerFactory, 
  EtcdStateStore, 
  CircuitBreakerState,
  CircuitBreakerOptions,
  ServiceCircuitBreakerConfig,
  CircuitBreakerEventType,
  CircuitBreakerMetrics,
  CircuitBreakerEventListeners,
  ServiceCallResult,
  ServiceName,
  ShardId
} from "guardrail";

// Configuration for the circuit breakers
const baseOptions: CircuitBreakerOptions = {
  failureThreshold: 3,
  resetTimeout: 2000,
  serviceTimeout: 1000,
  maxConcurrent: 10000,
  halfOpenRetryLimit: 1,
  monitorInterval: 5000,
};

async function main() {
  console.log("🔌 Enhanced Sharded Circuit Breaker Factory Demo");

  // Create an instance of EtcdStateStore with the specified hosts
  const etcdStore = new EtcdStateStore({
    hosts: ['http://localhost:2379']
  });

  // Create the factory with our state store and base options
  const factory = new ShardedCircuitBreakerFactory(etcdStore, baseOptions);
  
  try {
    // Define our services with custom configurations
    const services: ServiceCircuitBreakerConfig[] = [
      { 
        name: 'payment', 
        shardCount: 4,
        options: { failureThreshold: 2 } // Payment is more sensitive
      },
      { 
        name: 'inventory',
        shardCount: 4
      },
      { 
        name: 'shipping',
        shardCount: 4
      },
      { 
        name: 'recommendation',
        shardCount: 4,
        options: { failureThreshold: 5 } // Recommendations can tolerate more failures
      }
    ];
    
    console.log(`🔄 Creating circuit breakers for ${services.length} services...`);
    
    // Create circuit breakers for each service
    services.forEach(service => {
      console.log(`📌 Creating circuit breaker for ${service.name} service with threshold: ${
        service.options?.failureThreshold || baseOptions.failureThreshold
      }`);
      
      // Create the breakers for this service
      factory.createServiceBreakers(service);
      
      // Add event listeners for this service with proper typing
      factory.addServiceListeners(service.name, [
        {
          event: 'metrics',
          listener: (metrics: CircuitBreakerMetrics) => {
            console.log(`📊 ${service.name.toUpperCase()} metrics:`, metrics);
          }
        },
        {
          event: 'stateChange',
          listener: (stateChange: { from: CircuitBreakerState; to: CircuitBreakerState }) => {
            const { from, to } = stateChange;
            console.log(`🔄 ${service.name.toUpperCase()} state changed: ${from} → ${to}`);
            
            // Log more detailed information based on the state
            if (to === CircuitBreakerState.OPEN) {
              console.log(`⚠️ Circuit OPEN for ${service.name.toUpperCase()}: Service calls will fail fast until reset timeout`);
            } else if (to === CircuitBreakerState.HALF_OPEN) {
              console.log(`🔍 Circuit HALF-OPEN for ${service.name.toUpperCase()}: Testing with limited traffic`);
            } else if (to === CircuitBreakerState.CLOSED) {
              console.log(`✅ Circuit CLOSED for ${service.name.toUpperCase()}: Service operating normally`);
            }
          }
        },
        {
          event: 'failure',
          listener: (failure: { error: Error; stats: any }) => {
            console.log(`❌ ${service.name.toUpperCase()} failure detected:`, failure.error.message);
          }
        }
      ]);
    });
    
    // Simulate service calls
    await simulateServiceCalls(factory, services.map(s => s.name));
    
    // Show all service states
    console.log("\n📊 Final service states:");
    for (const serviceName of factory.getServices()) {
      const states = await factory.getServiceStates(serviceName);
      console.log(`${serviceName.toUpperCase()} service states:`, states);
    }
    
    console.log("\n✅ Simulation completed!");
  } finally {
    // Clean up all resources
    await factory.cleanup();
    await etcdStore.close();
    
    console.log("✅ Cleanup completed.");
    process.exit(0);
  }
}

// Simulate service calls with the factory
async function simulateServiceCalls(
  factory: ShardedCircuitBreakerFactory, 
  serviceNames: ServiceName[]
) {
  console.log("\n🚀 Simulating service calls...");
  
  // Target specific services for failures
  const targetedFailures: Array<{ service: ServiceName; shard: ShardId }> = [
    { service: 'payment', shard: 2 },
    { service: 'shipping', shard: 1 }
  ];
  
  console.log(`🎯 Targeting specific service-shards with failures:`);
  targetedFailures.forEach(target => {
    console.log(`   - ${target.service.toUpperCase()} Shard ${target.shard}`);
  });
  
  // Demonstrate key-based routing
  const userIds = ['user123', 'user456', 'user789', 'user101'];
  console.log(`\n🔑 Demonstrating key-based routing with user IDs: ${userIds.join(', ')}`);
  
  // Show which shard each user will be routed to
  for (const userId of userIds) {
    for (const service of serviceNames) {
      const result = await factory.executeWithKey(service, userId, async () => {
        return { userId, timestamp: Date.now() };
      });
      console.log(`User ${userId} routed to ${service.toUpperCase()} Shard ${result.shardId}`);
    }
  }
  
  console.log("\n📝 Simulating regular service calls:");
  
  // Simulate 10 requests
  for (let i = 0; i < 10; i++) {
    try {
      console.log(`\n📝 Request ${i + 1}/10:`);
      
      // Every 3rd request targets a specific service-shard for failure
      const useTargetedFailure = i % 3 === 0;
      
      let service: ServiceName;
      let shardId: ShardId;
      let forceFailure = false;
      
      if (useTargetedFailure) {
        // Pick one of our targeted service-shards
        const target = targetedFailures[i % targetedFailures.length];
        service = target.service;
        shardId = target.shard;
        forceFailure = true;
        
        console.log(`🎯 Targeting ${service.toUpperCase()} Shard ${shardId} (forced failure: ${forceFailure})`);
      } else {
        // Random service and shard
        service = serviceNames[Math.floor(Math.random() * serviceNames.length)];
        shardId = Math.floor(Math.random() * 4); // Assuming all services have 4 shards
        console.log(`🔀 Random selection: ${service.toUpperCase()} Shard ${shardId}`);
      }
      
      // Execute the service call through the factory
      console.log(`🔄 Calling ${service.toUpperCase()} service on Shard ${shardId}...`);
      
      const result: ServiceCallResult<{ success: boolean; timestamp: number }> = 
        await factory.executeServiceCall(service, shardId, async () => {
          // Simulate processing time
          await new Promise(resolve => setTimeout(resolve, Math.random() * 300));
          
          // Simulate success or failure
          if (forceFailure || Math.random() < 0.3) { // 30% chance to fail or forced failure
            console.log(`⚠️ Simulating a failure in ${service.toUpperCase()} Shard ${shardId}...`);
            throw new Error(`${service.toUpperCase()} service failure on Shard ${shardId}`);
          }
          
          console.log(`✅ ${service.toUpperCase()} service call succeeded on Shard ${shardId}`);
          return { success: true, timestamp: Date.now() };
        });
      
      if (result.success) {
        console.log(`✅ Call succeeded in ${result.responseTime}ms`);
      } else {
        if (result.circuitOpen) {
          console.log(`🛑 Fast fail: Circuit is OPEN for ${service.toUpperCase()} Shard ${shardId}`);
        } else {
          console.log(`❌ Error calling ${service.toUpperCase()} service on Shard ${shardId}: ${result.error?.message}`);
        }
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Request ${i + 1} processing error:`, error);
    }
  }
}

// Handle process signals for graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Exiting...');
  process.exit(0);
});

// Run the main function
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
