import { HighPerformanceCircuitBreaker } from './HighPerformanceCircuitBreaker.js';
import { 
  CircuitBreakerOptions, 
  StateStore, 
  CircuitBreakerState,
  ServiceName,
  ShardId,
  ServiceCircuitBreakerConfig,
  CircuitBreakerEventType,
  CircuitBreakerEventListeners,
  EventListenerConfig,
  ServiceCallResult,
  StoredEventListener,
} from './types.js';

/**
 * Factory class for creating and managing sharded circuit breakers
 */
export class ShardedCircuitBreakerFactory {
  private readonly stateStore: StateStore;
  private readonly baseOptions: CircuitBreakerOptions;
  private readonly serviceBreakers: Record<ServiceName, HighPerformanceCircuitBreaker[]> = {};
  private readonly eventListeners: Record<ServiceName, StoredEventListener[]> = {};
  private readonly serviceConfigs: Record<ServiceName, ServiceCircuitBreakerConfig> = {};

  /**
   * Create a new ShardedCircuitBreakerFactory
   * 
   * @param stateStore - The state store to use for persisting circuit breaker states
   * @param baseOptions - Base options for all circuit breakers
   */
  constructor(stateStore: StateStore, baseOptions: CircuitBreakerOptions) {
    this.stateStore = stateStore;
    this.baseOptions = {
      ...baseOptions,
    };
  }

  /**
   * Create circuit breakers for a service with the specified number of shards
   * 
   * @param config - Configuration for the service
   * @returns Array of circuit breakers for the service
   */
  public createServiceBreakers(config: ServiceCircuitBreakerConfig): HighPerformanceCircuitBreaker[] {
    const { name, shardCount = 4, options = {} } = config;
    
    if (this.serviceBreakers[name]) {
      throw new Error(`Service "${name}" already exists. Use getServiceBreakers() to access it.`);
    }
    
    // Store the config for reference
    this.serviceConfigs[name] = {
      name,
      shardCount,
      options
    };
    
    // Merge base options with service-specific options
    const serviceOptions: CircuitBreakerOptions = {
      ...this.baseOptions,
      ...options,
    };
    
    // Create array of circuit breakers (shards) for this service
    const breakers = Array(shardCount)
      .fill(null)
      .map((_, i) => new HighPerformanceCircuitBreaker(`${name}-${i}`, this.stateStore, serviceOptions));
    
    // Store the breakers for this service
    this.serviceBreakers[name] = breakers;
    
    return breakers;
  }

  /**
   * Add event listeners to all circuit breakers for a service
   * 
   * @param serviceName - Name of the service
   * @param listeners - Array of event listeners to add
   */
  public addServiceListeners<T extends CircuitBreakerEventType>(
    serviceName: ServiceName, 
    listeners: Array<EventListenerConfig<T>>
  ): void {
    const breakers = this.serviceBreakers[serviceName];
    if (!breakers) {
      throw new Error(`Service "${serviceName}" not found. Create it first with createServiceBreakers().`);
    }
    
    // Store listeners for cleanup
    if (!this.eventListeners[serviceName]) {
      this.eventListeners[serviceName] = [];
    }
    
    // Add each listener to each breaker
    listeners.forEach(listenerConfig => {
      const { event, listener } = listenerConfig;
      
      breakers.forEach(breaker => {
        // Type-safe event handling
        switch (event) {
          case 'stateChange':
            breaker.on(event, listener as CircuitBreakerEventListeners['stateChange']);
            break;
          case 'metrics':
            breaker.on(event, listener as CircuitBreakerEventListeners['metrics']);
            break;
          case 'failure':
            breaker.on(event, listener as CircuitBreakerEventListeners['failure']);
            break;
          case 'success':
            breaker.on(event, listener as CircuitBreakerEventListeners['success']);
            break;
          case 'timeout':
            breaker.on(event, listener as CircuitBreakerEventListeners['timeout']);
            break;
          case 'rejected':
            breaker.on(event, listener as CircuitBreakerEventListeners['rejected']);
            break;
        }
      });
      
      this.eventListeners[serviceName].push({ 
        event, 
        listener: listener as CircuitBreakerEventListeners[CircuitBreakerEventType]
      });
    });
  }

  /**
   * Get all circuit breakers for a service
   * 
   * @param serviceName - Name of the service
   * @returns Array of circuit breakers for the service
   */
  public getServiceBreakers(serviceName: ServiceName): HighPerformanceCircuitBreaker[] {
    const breakers = this.serviceBreakers[serviceName];
    if (!breakers) {
      throw new Error(`Service "${serviceName}" not found. Create it first with createServiceBreakers().`);
    }
    return breakers;
  }

  /**
   * Get a specific circuit breaker for a service by shard ID
   * 
   * @param serviceName - Name of the service
   * @param shardId - ID of the shard
   * @returns The circuit breaker for the specified shard
   */
  public getServiceBreaker(serviceName: ServiceName, shardId: ShardId): HighPerformanceCircuitBreaker {
    const breakers = this.getServiceBreakers(serviceName);
    if (shardId < 0 || shardId >= breakers.length) {
      throw new Error(`Invalid shard ID "${shardId}" for service "${serviceName}". Valid range: 0-${breakers.length - 1}.`);
    }
    return breakers[shardId];
  }

  /**
   * Get the configuration for a service
   * 
   * @param serviceName - Name of the service
   * @returns The configuration for the service
   */
  public getServiceConfig(serviceName: ServiceName): ServiceCircuitBreakerConfig {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`Service "${serviceName}" not found. Create it first with createServiceBreakers().`);
    }
    return config;
  }

  /**
   * Get all registered services
   * 
   * @returns Array of service names
   */
  public getServices(): ServiceName[] {
    return Object.keys(this.serviceBreakers);
  }

  /**
   * Check if a service exists
   * 
   * @param serviceName - Name of the service
   * @returns True if the service exists, false otherwise
   */
  public hasService(serviceName: ServiceName): boolean {
    return !!this.serviceBreakers[serviceName];
  }

  /**
   * Get the current state of a service's circuit breaker
   * 
   * @param serviceName - Name of the service
   * @param shardId - ID of the shard
   * @returns The current state of the circuit breaker
   */
  public async getServiceState(serviceName: ServiceName, shardId: ShardId): Promise<CircuitBreakerState> {
    const breaker = this.getServiceBreaker(serviceName, shardId);
    const stats = await breaker.getStats();
    return stats?.state || CircuitBreakerState.CLOSED;
  }

  /**
   * Get the current states of all shards for a service
   * 
   * @param serviceName - Name of the service
   * @returns Object mapping shard IDs to their current states
   */
  public async getServiceStates(serviceName: ServiceName): Promise<Record<ShardId, CircuitBreakerState>> {
    const breakers = this.getServiceBreakers(serviceName);
    const states: Record<ShardId, CircuitBreakerState> = {};
    
    await Promise.all(
      breakers.map(async (breaker, shardId) => {
        const stats = await breaker.getStats();
        states[shardId] = stats?.state || CircuitBreakerState.CLOSED;
      })
    );
    
    return states;
  }

  /**
   * Execute a service call through the appropriate circuit breaker
   * 
   * @param serviceName - Name of the service
   * @param shardId - ID of the shard
   * @param serviceCall - Function to execute
   * @returns Result of the service call with detailed information
   */
  public async executeServiceCall<T>(
    serviceName: ServiceName,
    shardId: ShardId,
    serviceCall: () => Promise<T>
  ): Promise<ServiceCallResult<T>> {
    const breaker = this.getServiceBreaker(serviceName, shardId);
    const startTime = Date.now();
    
    try {
      const result = await breaker.execute(serviceCall);
      const responseTime = Date.now() - startTime;
      
      return {
        success: true,
        data: result,
        service: serviceName,
        shardId,
        responseTime
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const circuitOpen = error instanceof Error && error.message.includes('Circuit breaker is OPEN');
      
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        service: serviceName,
        shardId,
        responseTime,
        circuitOpen
      };
    }
  }

  /**
   * Execute a service call with automatic shard selection based on a key
   * 
   * @param serviceName - Name of the service
   * @param key - Key to use for shard selection (e.g., user ID, request ID)
   * @param serviceCall - Function to execute
   * @returns Result of the service call with detailed information
   */
  public async executeWithKey<T>(
    serviceName: ServiceName,
    key: string,
    serviceCall: () => Promise<T>
  ): Promise<ServiceCallResult<T>> {
    const breakers = this.getServiceBreakers(serviceName);
    const shardId = this.getShardIdForKey(key, breakers.length);
    
    return this.executeServiceCall(serviceName, shardId, serviceCall);
  }

  /**
   * Get a shard ID for a key using consistent hashing
   * 
   * @param key - Key to hash
   * @param shardCount - Number of shards
   * @returns Shard ID for the key
   */
  private getShardIdForKey(key: string, shardCount: number): ShardId {
    // Simple hash function for consistent sharding
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash) + key.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    
    // Ensure positive value and modulo by shard count
    return Math.abs(hash) % shardCount;
  }

  /**
   * Remove all event listeners and stop all circuit breakers
   */
  public async cleanup(): Promise<void> {
    // Remove all event listeners
    Object.entries(this.eventListeners).forEach(([serviceName, listeners]) => {
      const breakers = this.serviceBreakers[serviceName];
      if (breakers) {
        listeners.forEach(({ event, listener }) => {
          breakers.forEach(breaker => {
            // Type-safe event removal
            switch (event) {
              case 'stateChange':
                breaker.removeListener(event, listener as CircuitBreakerEventListeners['stateChange']);
                break;
              case 'metrics':
                breaker.removeListener(event, listener as CircuitBreakerEventListeners['metrics']);
                break;
              case 'failure':
                breaker.removeListener(event, listener as CircuitBreakerEventListeners['failure']);
                break;
              case 'success':
                breaker.removeListener(event, listener as CircuitBreakerEventListeners['success']);
                break;
              case 'timeout':
                breaker.removeListener(event, listener as CircuitBreakerEventListeners['timeout']);
                break;
              case 'rejected':
                breaker.removeListener(event, listener as CircuitBreakerEventListeners['rejected']);
                break;
            }
          });
        });
      }
    });
    
    // Stop all circuit breakers
    Object.values(this.serviceBreakers).flat().forEach(breaker => {
      breaker.stop();
      // No need for unsafe cast since we're using the stop method directly
    });
    
    // Clear internal state
    Object.keys(this.serviceBreakers).forEach(key => {
      delete this.serviceBreakers[key];
    });
    
    Object.keys(this.eventListeners).forEach(key => {
      delete this.eventListeners[key];
    });
    
    Object.keys(this.serviceConfigs).forEach(key => {
      delete this.serviceConfigs[key];
    });
  }
}
