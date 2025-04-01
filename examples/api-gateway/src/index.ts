import express from 'express';
import axios from 'axios';
import winston from 'winston';
import { HighPerformanceCircuitBreaker, EtcdStateStore } from 'guardrail';

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Configure the etcd state store
const etcdStateStore = new EtcdStateStore({
  hosts: ['localhost:2379']
});

// Create circuit breakers for different services
const circuitBreakers = new Map<string, HighPerformanceCircuitBreaker>();

// Function to get or create a circuit breaker for a service
function getCircuitBreaker(serviceName: string): HighPerformanceCircuitBreaker {
  if (!circuitBreakers.has(serviceName)) {
    const circuitBreaker = new HighPerformanceCircuitBreaker(
      serviceName,
      etcdStateStore,
      {
        failureThreshold: 5,
        resetTimeout: 15000, // 15 seconds in open state
        halfOpenRetryLimit: 3,
        serviceTimeout: 3000,
        maxConcurrent: 1000
      }
    );
    
    circuitBreakers.set(serviceName, circuitBreaker);
  }
  
  return circuitBreakers.get(serviceName)!;
}

// Create Express app
const app = express();
const port = 3000;

// Middleware to parse JSON
app.use(express.json());

// Define mock service endpoints
const serviceEndpoints = {
  users: 'https://jsonplaceholder.typicode.com/users',
  posts: 'https://jsonplaceholder.typicode.com/posts',
  comments: 'https://jsonplaceholder.typicode.com/comments',
};

// API Gateway route
app.get('/api/:service/:id?', async (req, res) => {
  const { service, id } = req.params;
  const serviceEndpoint = serviceEndpoints[service as keyof typeof serviceEndpoints];
  
  if (!serviceEndpoint) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  const circuitBreaker = getCircuitBreaker(service);
  
  try {
    // Construct the URL based on whether an ID was provided
    const url = id ? `${serviceEndpoint}/${id}` : serviceEndpoint;
    
    // Use the circuit breaker to execute the request
    const result = await circuitBreaker.execute(async () => {
      const response = await axios.get(url, { timeout: 3000 });
      return response.data;
    });
    
    // Return the service response
    return res.json(result);
  } catch (error) {
    logger.error(`Service ${service} request failed: ${(error as Error).message}`);
    
    // Return error response
    return res.status(500).json({ 
      error: 'Service unavailable',
      message: (error as Error).message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'UP' });
});

// Circuit breaker status endpoint
app.get('/circuit-status', async (req, res) => {
  const statuses = await Promise.all(
    Array.from(circuitBreakers.entries()).map(async ([service, cb]) => {
      const stats = await etcdStateStore.getState(service);
      return {
        service,
        status: stats?.state || 'UNKNOWN',
      };
    })
  );
  
  res.json(statuses);
});

// Start the server
app.listen(port, () => {
  logger.info(`API Gateway started on port ${port}`);
});

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  await etcdStateStore.close();
  process.exit(0);
});