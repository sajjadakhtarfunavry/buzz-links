/**
 * Buzz Links Edge — GET /{slug} redirect handler
 * Resolves link (KV → webhook), builds click payload, enqueues, 302 to destination
 */

import {
  COOKIE_NAME,
  KV_KEY_PREFIX,
  LINK_KV_TTL,
} from './constants.js';
import {
  log,
  notFound,
  hashForLog,
  appendParams,
  formatCookie,
  generateClickEventId,
  getOrCreateSessionId,
  getClientIp,
  shouldEnqueueClick,
} from './utils.js';
import { getBotSignals } from './bot-signals.js';
import { checkRateLimit } from './rate-limit.js';
import { fetchLinkFromBackendWebhook } from './backend.js';

export async function handleRedirect(request, env, ctx) {
  const startMs = Date.now();
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const slug = url.pathname.slice(1);
  if (!slug || slug.includes('/')) {
    log(env, 'buzzlink_redirect_not_found', {
      slug: slug || '(empty)',
      reason: 'invalid_path',
    });
    return notFound();
  }

  const ffOn = (env.FF_V2_BUZZ_LINKS || 'true').toLowerCase() === 'true';
  if (!ffOn) {
    log(env, 'buzzlink_redirect_not_found', { slug, reason: 'feature_disabled' });
    return notFound();
  }

  const ip = getClientIp(request);
  const ipHash = await hashForLog(env, ip);
  log(env, 'buzzlink_redirect_received', { slug, latency_ms: Date.now() - startMs });

  // Rate limit (optional KV)
  const rateLimit = parseInt(env.RATE_LIMIT_REQUESTS_PER_MINUTE || '100', 10);
  if (env.RATE_LIMIT_KV && rateLimit > 0) {
    const limited = await checkRateLimit(env, ip, slug, rateLimit);
    if (limited) {
      log(env, 'buzzlink_rate_limited', { slug, identifier: ipHash });
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  // Resolve link: KV cache → backend webhook
  const { link, cacheHit } = await resolveLink(env, ctx, slug);
  if (!link || link.status !== 'ACTIVE') {
    log(env, 'buzzlink_redirect_not_found', {
      slug,
      reason: !link ? 'not_found' : 'disabled',
      cache_hit: cacheHit,
      latency_ms: Date.now() - startMs,
    });
    return notFound();
  }

  const sessionId = getOrCreateSessionId(request);
  const destinationUrl = appendParams(link.destination_url, {
    buzz_sid: sessionId,
    buzz_cid: String(link.campaign_id),
    buzz_lid: String(link.link_id),
  });

  const clickEventId = generateClickEventId();
  const countryCode = request.headers.get('CF-IPCountry') || request.cf?.country || '';
  const uaHash = await hashForLog(env, request.headers.get('User-Agent') || '');
  const { bot_score: botScore, verified_bot: verifiedBot } = getBotSignals(request);

  const payload = {
    click_event_id: clickEventId,
    ts: new Date().toISOString(),
    slug,
    link_id: String(link.link_id),
    campaign_id: link.campaign_id,
    owner_user_id: link.owner_user_id,
    destination_id: link.destination_id ?? null,
    session_id: sessionId,
    destination_url: destinationUrl,
    country_code: countryCode || undefined,
    ip_hash: ipHash || undefined,
    ua_hash: uaHash || undefined,
    wallet_address: link.wallet_address ?? undefined,
    bot_score: botScore,
    verified_bot: verifiedBot,
  };

  const { enqueue: shouldEnqueue, reason: skipReason } = shouldEnqueueClick(request);
  log(env, 'shouldEnqueue', { shouldEnqueue: shouldEnqueue, skipReason: skipReason });
  if (env.CLICKS_QUEUE && shouldEnqueue) {
    try {
      await env.CLICKS_QUEUE.send(payload);
      log(env, 'buzzlink_event_enqueued', {
        click_event_id: clickEventId,
        campaign_id: link.campaign_id,
        link_id: link.link_id,
      });
    } catch (err) {
      log(env, 'buzzlink_event_enqueue_failed', {
        click_event_id: clickEventId,
        error: String(err?.message ?? err),
      });
    }
  } else if (env.CLICKS_QUEUE && skipReason) {
    log(env, 'buzzlink_event_skipped', {
      slug,
      campaign_id: link.campaign_id,
      link_id: link.link_id,
      reason: skipReason,
    });
  }

  log(env, 'buzzlink_redirect_success', {
    slug,
    campaign_id: link.campaign_id,
    link_id: link.link_id,
    session_id: sessionId,
    cache_hit: cacheHit,
    latency_ms: Date.now() - startMs,
  });

  const res = new Response(null, {
    status: 302,
    headers: {
      Location: destinationUrl,
      'Set-Cookie': formatCookie(COOKIE_NAME, sessionId),
    },
  });
  return res;
}

async function resolveLink(env, ctx, slug) {
  let link = null;
  let cacheHit = false;
  const hasKv = env.LINKS_KV != null;

  if (hasKv) {
    const raw = await env.LINKS_KV.get(KV_KEY_PREFIX + slug);
    if (raw) {
      try {
        link = JSON.parse(raw);
        cacheHit = true;
      } catch (_) {
        link = null;
      }
    }
  }

  if (!link && env.BACKEND_FALLBACK_URL && env.BUZZ_LINKS_WEBHOOK_SECRET) {
    link = await fetchLinkFromBackendWebhook(env, slug);

    if (link && hasKv) {
      ctx.waitUntil(
        env.LINKS_KV.put(KV_KEY_PREFIX + slug, JSON.stringify(link), {
          expirationTtl: LINK_KV_TTL,
        })
      );
    }
  }

  return { link, cacheHit };
}
