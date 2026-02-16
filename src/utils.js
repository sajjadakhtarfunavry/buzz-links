/**
 * Buzz Links Edge — logging, response helpers, cookie/URL, ID generation
 */

import {
  COOKIE_NAME,
  COOKIE_MAX_AGE,
} from './constants.js';

// ——— Logging ———

export function log(env, event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

// ——— Responses ———

export function notFound() {
  return new Response('Link not found or inactive', { status: 404 });
}

// ——— Client IP (CF-Connecting-IP only set at Cloudflare edge; fallback for local dev) ———

export function getClientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf;
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return '127.0.0.1'; // local / wrangler dev
}

// ——— Hashing (privacy-safe) ———

export async function hashForLog(env, value) {
  if (!value) return '';
  const salt = env.EDGE_IP_HASH_SALT || 'default-salt-change-in-production';
  const data = new TextEncoder().encode(salt + value);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(buf);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

// ——— URL ———

export function appendParams(baseUrl, params) {
  try {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') u.searchParams.set(k, v);
    }
    return u.toString();
  } catch (_) {
    return baseUrl;
  }
}

// ——— Cookie ———

export function formatCookie(name, value) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ].join('; ');
}

// ——— IDs ———

/**
 * Unique id per click event. Backend uses for idempotency (SETNX, ledger key).
 */
export function generateClickEventId() {
  try {
    return `evt_${crypto.randomUUID().replace(/-/g, '')}`;
  } catch (_) {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 12);
    return `evt_${(t + r).slice(0, 24)}`;
  }
}

// ——— Click attribution: only count when it looks like a real user navigation ———

const PREFETCH_PURPOSES = ['prefetch', 'preload'];

/**
 * Whether to enqueue this request as a click (vs redirect-only).
 * Skips when: HEAD (probe), Range (partial/probe), prefetch/preload,
 * Sec-Fetch-Mode not navigate, Sec-Fetch-Dest not document.
 * @returns {{ enqueue: boolean, reason?: string }} reason only when enqueue is false
 */
export function shouldEnqueueClick(request) {
  if (request.method === 'HEAD') return { enqueue: false, reason: 'head_probe' };
  if (request.headers.get('Range')) return { enqueue: false, reason: 'range_probe' };

  const purpose = (request.headers.get('Sec-Purpose') || request.headers.get('Purpose') || '').toLowerCase();
  if (PREFETCH_PURPOSES.some((p) => purpose.includes(p))) return { enqueue: false, reason: 'prefetch_or_preload' };

  const mode = request.headers.get('Sec-Fetch-Mode');
  if (mode != null && mode !== '' && mode !== 'navigate') return { enqueue: false, reason: 'sec_fetch_mode_not_navigate' };

  const dest = request.headers.get('Sec-Fetch-Dest');
  if (dest != null && dest !== '' && dest !== 'document') return { enqueue: false, reason: 'sec_fetch_dest_not_document' };

  return { enqueue: true };
}

// ——— Session (cookie-based) ———

export function getOrCreateSessionId(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (match?.[1]) return match[1].trim();
  return generateClickEventId();
}
