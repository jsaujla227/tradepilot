import "server-only";
import { Redis } from "@upstash/redis";

// Upstash Redis (REST API). Provisioned via the Vercel Marketplace; the two
// env vars below are populated automatically once the integration is linked.
// We treat the cache as best-effort: every call swallows errors and falls back
// to the source-of-truth fetch so a Redis outage never breaks the cockpit.

let cachedClient: Redis | null = null;
let warnedMissing = false;

function getRedis(): Redis | null {
  if (cachedClient) return cachedClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedMissing && process.env.NODE_ENV !== "production") {
      warnedMissing = true;
      console.warn(
        "[redis] UPSTASH_REDIS_REST_URL/TOKEN not set — running without cache",
      );
    }
    return null;
  }
  cachedClient = new Redis({ url, token });
  return cachedClient;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const value = await redis.get<T>(key);
    return value ?? null;
  } catch (err) {
    console.warn(`[redis] GET ${key} failed`, err);
    return null;
  }
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[redis] SET ${key} failed`, err);
  }
}

/**
 * Wrap a source-of-truth fetch with a Redis read-through cache.
 * On any Redis error the fetcher runs unguarded — the cockpit must keep
 * serving live data even when the cache is down.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return { value: hit, hit: true };
  const value = await fetcher();
  await cacheSet(key, value, ttlSeconds);
  return { value, hit: false };
}

/**
 * Acquire a TTL-bounded exclusive lock. Returns true if the lock was obtained,
 * false if it was already held. Falls back to true (allow) on Redis errors so
 * a cache outage never blocks the app.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    const result = await redis.set(key, "1", { nx: true, ex: ttlSeconds });
    return result === "OK";
  } catch {
    return true;
  }
}

export async function releaseLock(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // best-effort
  }
}
