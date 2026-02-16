/**
 * Buzz Links Edge — shared constants
 */

export const COOKIE_NAME = 'buzz_sid';
export const COOKIE_MAX_AGE = 86400; // 24h

export const KV_KEY_PREFIX = 'link:';
export const LINK_KV_TTL = 120;

export const RATE_LIMIT_KEY_PREFIX = 'rl:';
export const RATE_LIMIT_TTL = 60;

export const FALLBACK_TIMEOUT_MS = 2000;

export const WEBHOOK_RESOLVE_PATH = '/webhook/buzz-links/resolve';
export const WEBHOOK_CLICK_PATH = '/webhook/buzz-links/click';
export const WEBHOOK_SOURCE = 'buzz_links';
