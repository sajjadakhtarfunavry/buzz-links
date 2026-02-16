/**
 * Buzz Links Edge — resolve slug to link via webhook API
 */

import {
  FALLBACK_TIMEOUT_MS,
  WEBHOOK_RESOLVE_PATH,
  WEBHOOK_SOURCE,
} from './constants.js';

/**
 * Resolve via Buzz Links Webhook: GET /webhook/buzz-links/resolve/:slug
 * Auth: X-API-Key, X-Source: buzz_links
 */
export async function fetchLinkFromBackendWebhook(env, slug) {
  const base = (env.BACKEND_FALLBACK_URL || '').replace(/\/$/, '');
  const secret = env.BUZZ_LINKS_WEBHOOK_SECRET;
  if (!base || !secret) return null;

  const url = `${base}${WEBHOOK_RESOLVE_PATH}/${encodeURIComponent(slug)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': secret,
        'X-Source': WEBHOOK_SOURCE,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status !== 200) return null;

    const data = await res.json();
    if (!data?.destination_url || data.link_id == null) return null;

    return {
      campaign_id: data.campaign_id,
      link_id: data.link_id,
      destination_url: data.destination_url,
      wallet_address: data.wallet_address ?? '',
      status: data.status ?? 'ACTIVE',
    };
  } catch (_) {
    clearTimeout(timeout);
    return null;
  }
}
