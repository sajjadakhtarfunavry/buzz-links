/**
 * Buzz Links Edge — queue consumer
 * Receives click events from buzz-link-clicks, POSTs to backend webhook
 */

import { WEBHOOK_CLICK_PATH, WEBHOOK_SOURCE } from './constants.js';
import { log } from './utils.js';

export async function handleQueue(batch, env, ctx) {
  const base = (env.BACKEND_FALLBACK_URL || '').replace(/\/$/, '');
  const secret = env.BUZZ_LINKS_WEBHOOK_SECRET;

  const url = base ? `${base}${WEBHOOK_CLICK_PATH}` : null;

  if (!url || !secret) {
    log(env, 'buzzlink_consumer_skip', {
      reason: 'missing_backend_or_secret',
      queue: batch.queue,
    });
    batch.retryAll();
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': secret,
    'X-Source': WEBHOOK_SOURCE,
  };

  for (const message of batch.messages) {
    try {
      const body =
        typeof message.body === 'object'
          ? message.body
          : JSON.parse(String(message.body));

      const payload = toWebhookPayload(body);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok || res.status === 202) {
        message.ack();
        log(env, 'buzzlink_consumer_acked', {
          message_id: message.id,
          click_event_id: body.click_event_id,
        });
      } else {
        const text = await res.text();
        log(env, 'buzzlink_consumer_retry', {
          message_id: message.id,
          status: res.status,
          body: text.slice(0, 200),
        });
        message.retry();
      }
    } catch (err) {
      log(env, 'buzzlink_consumer_retry', {
        message_id: message.id,
        error: String(err?.message ?? err),
      });
      message.retry();
    }
  }
}

function toWebhookPayload(body) {
  const ts =
    body.ts != null
      ? typeof body.ts === 'number'
        ? body.ts
        : Math.floor(new Date(body.ts).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

  return {
    click_event_id: body.click_event_id,
    campaign_id: body.campaign_id,
    link_id: body.link_id,
    owner_user_id: body.owner_user_id,
    wallet_address: body.wallet_address ?? '',
    session_id: body.session_id,
    ip_hash: body.ip_hash ?? '',
    ua_hash: body.ua_hash,
    country_code: body.country_code,
    bot_score: body.bot_score,
    verified_bot: body.verified_bot,
    ts,
  };
}
