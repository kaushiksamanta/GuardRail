export enum CircuitBreakerState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening the circuit
  resetTimeout: number; // Time in ms before attempting to half-open
  halfOpenRetryLimit: number; // Number of requests to try when half-open
  monitorInterval: number; // Health check interval in ms
  serviceTimeout: number; // Timeout for service requests in ms
  maxConcurrent?: number; // Maximum concurrent requests allowed
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastError: string | null;
  currentLoad?: number; // Current number of active requests
  averageResponseTime?: number; // Average response time in ms
  lastMinuteRequests?: number; // Requests in the last minute
  lastUpdateTime?: number; // Last time the stats were updated
}

export interface StateStore {
  getState(serviceKey: string): Promise<CircuitBreakerStats | null>;
  setState(serviceKey: string, stats: CircuitBreakerStats): Promise<void>;
  incrementFailureCount(serviceKey: string): Promise<number>;
  resetStats(serviceKey: string): Promise<void>;
  close(): Promise<void>;
  watchState(
    serviceKey: string,
    callback: (stats: CircuitBreakerStats) => void,
  ): void;
}

export type ServiceCall<T> = () => Promise<T>;

export interface CircuitBreakerMetrics {
  requestRate: number; // Requests per second
  errorRate: number; // Errors per second
  averageResponseTime: number; // Average response time in ms
  currentLoad: number; // Current number of active requests
  lastMinuteStats: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
  };
}

/**
 * Service names type for type safety
 */
export type ServiceName = string;

/**
 * Shard ID type for type safety
 */
export type ShardId = number;

/**
 * Configuration for a service's circuit breaker
 */
export interface ServiceCircuitBreakerConfig {
  /** Service name */
  name: ServiceName;
  /** Number of shards to create (default: 4) */
  shardCount?: number;
  /** Custom options for this service's circuit breaker */
  options?: Partial<CircuitBreakerOptions>;
}

/**
 * Event types that can be listened to
 */
export type CircuitBreakerEventType = 'stateChange' | 'metrics' | 'failure' | 'success' | 'timeout' | 'rejected';

/**
 * Type definitions for event listeners
 */
export interface CircuitBreakerEventListeners {
  stateChange: (stateChange: { from: CircuitBreakerState; to: CircuitBreakerState }) => void;
  metrics: (metrics: CircuitBreakerMetrics) => void;
  failure: (failure: { error: Error; stats: CircuitBreakerStats }) => void;
  success: (result: { responseTime: number; stats: CircuitBreakerStats }) => void;
  timeout: (timeout: { error: Error; stats: CircuitBreakerStats }) => void;
  rejected: (rejected: { error: Error; stats: CircuitBreakerStats }) => void;
}

/**
 * Event listener configuration with type safety
 */
export interface EventListenerConfig<T extends CircuitBreakerEventType> {
  /** Event name to listen for */
  event: T;
  /** Listener function to call when event is emitted */
  listener: CircuitBreakerEventListeners[T];
}

/**
 * Result of a service call execution
 */
export interface ServiceCallResult<T> {
  /** Whether the call was successful */
  success: boolean;
  /** The result of the call if successful */
  data?: T;
  /** The error if the call failed */
  error?: Error;
  /** The service name that was called */
  service: ServiceName;
  /** The shard ID that was used */
  shardId: ShardId;
  /** The response time in milliseconds */
  responseTime?: number;
  /** Whether the circuit was open and the call was rejected */
  circuitOpen?: boolean;
}

/**
 * Type for storing event listeners with their event types
 */
export type StoredEventListener = {
  event: CircuitBreakerEventType;
  listener: CircuitBreakerEventListeners[CircuitBreakerEventType];
};