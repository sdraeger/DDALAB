import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { createClient } from "redis";

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});
let rateLimiter: RateLimiterRedis | null = null;

const initializeRateLimiter = () => {
  if (!rateLimiter) {
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      points: 3, // Max 3 requests
      duration: 60, // Per 60 seconds
    });
  }
  return rateLimiter;
};

export const rateLimit = async (key: string) => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  const limiter = initializeRateLimiter();

  try {
    await limiter.consume(key);
    return { success: true };
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return { success: false, retryAfter: error.msBeforeNext / 1000 };
    }
    return { success: false, retryAfter: 0 };
  }
};
