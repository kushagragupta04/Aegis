import Redis from 'ioredis';
import { env } from './env.js';

// Normalize Upstash URLs (force rediss://)
const normalizedURL = env.REDIS_URL.includes('upstash.io')
  ? env.REDIS_URL.replace('redis://', 'rediss://')
  : env.REDIS_URL;

// TLS is decided purely by URL scheme, not by NODE_ENV. "production always
// means TLS" doesn't hold universally — e.g. ElastiCache without in-transit
// encryption enabled is a plain redis:// endpoint even in production, and a
// forced TLS handshake against it fails with ERR_SSL_WRONG_VERSION_NUMBER.
const isTLS = normalizedURL.startsWith('rediss://');

const getRedisOptions = () => ({
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 0,

  // TLS for Upstash
  tls: isTLS ? {} : undefined,

  // Prevent aggressive connection attempts
  lazyConnect: true,

  // Keep connection alive (safe, no billing impact)
  keepAlive: 30000,

  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

// Main Redis client
export const redis = new Redis(normalizedURL, getRedisOptions());

// BullMQ Redis client
export const bullmqRedis = new Redis(normalizedURL, getRedisOptions());

// 🔥 Explicitly connect (IMPORTANT because of lazyConnect).
// bullmqRedis in particular is frequently already connecting/connected by the
// time this runs — BullMQ's own Queue/Worker instances (created at import
// time, before this is awaited) issue commands on it immediately, and
// lazyConnect means that first command already triggered the connection.
// ioredis throws if you call .connect() on a client that's already
// connecting — that's not a real failure (the connection IS being
// established), so it's treated as success rather than propagated.
const connectIfNeeded = async (client) => {
  try {
    await client.connect();
  } catch (err) {
    if (/already connect/i.test(err.message)) return;
    throw err;
  }
};

export const connectRedis = async () => {
  try {
    await connectIfNeeded(redis);
    await connectIfNeeded(bullmqRedis);

    console.log('✅ Redis connected');
  } catch (err) {
    console.error('❌ Redis connection failed:', err.message);
    throw err; // a genuine connection failure — fail startup loudly rather than limping along with a dead cache/queue backend
  }
};

// 🔍 Event logging (helps debugging)
redis.on('ready', () => console.log('🚀 Redis ready'));
redis.on('error', (err) => console.error('❌ Redis error:', err));
redis.on('close', () => console.log('⚠️ Redis closed'));
redis.on('reconnecting', () => console.log('🔄 Redis reconnecting'));

bullmqRedis.on('error', (err) =>
  console.error('❌ BullMQ Redis error:', err)
);