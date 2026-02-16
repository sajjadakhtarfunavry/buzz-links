/**
 * Buzz Links Edge — per-IP rate limiting via KV
 */

import { RATE_LIMIT_KEY_PREFIX, RATE_LIMIT_TTL } from './constants.js';

export async function checkRateLimit(env, ip, slug, limit) {
  if (!env.RATE_LIMIT_KV) return false;

  const window = Math.floor(Date.now() / 60000);
  const key = `${RATE_LIMIT_KEY_PREFIX}${ip}:${window}`;

  try {
    const raw = await env.RATE_LIMIT_KV.get(key);
    const count = raw ? parseInt(raw, 10) : 0;
    if (count >= limit) return true;
    await env.RATE_LIMIT_KV.put(key, String(count + 1), {
      expirationTtl: RATE_LIMIT_TTL,
    });
    return false;
  } catch (_) {
    return false;
  }
}
