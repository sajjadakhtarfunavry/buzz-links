/**
 * Buzz Links Edge Redirect — Cloudflare Worker
 *
 * GET /{slug} → resolve link, set buzz_sid cookie, enqueue click, 302 to destination.
 * Queue consumer → POST click events to backend webhook.
 */

import { handleRedirect } from './redirect-handler.js';
import { handleQueue } from './queue-handler.js';

export default {
  fetch: handleRedirect,
  queue: handleQueue,
};
