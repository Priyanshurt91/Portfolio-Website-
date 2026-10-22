/**
 * In-Memory Sliding Window Rate Limiter
 * Suitable for serverless instances and local development.
 * Note: Each serverless worker maintains its own in-memory state.
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 15; // 15 requests per minute per IP

const ipRequests = new Map();

// Periodic cleanup to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequests.entries()) {
    if (now - record.startTime > WINDOW_MS) {
      ipRequests.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref?.();

/**
 * Checks if a client IP is within rate limits.
 * @param {string} ip
 * @returns {{ allowed: boolean, remaining: number, resetInSeconds: number }}
 */
export function checkRateLimit(ip) {
  const clientIp = ip || 'unknown-client';
  const now = Date.now();
  const record = ipRequests.get(clientIp);

  if (!record || now - record.startTime > WINDOW_MS) {
    ipRequests.set(clientIp, {
      count: 1,
      startTime: now
    });
    return {
      allowed: true,
      remaining: MAX_REQUESTS - 1,
      resetInSeconds: Math.ceil(WINDOW_MS / 1000)
    };
  }

  if (record.count >= MAX_REQUESTS) {
    const resetInSeconds = Math.ceil((record.startTime + WINDOW_MS - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.max(1, resetInSeconds)
    };
  }

  record.count += 1;
  const resetInSeconds = Math.ceil((record.startTime + WINDOW_MS - now) / 1000);
  return {
    allowed: true,
    remaining: MAX_REQUESTS - record.count,
    resetInSeconds: Math.max(1, resetInSeconds)
  };
}
