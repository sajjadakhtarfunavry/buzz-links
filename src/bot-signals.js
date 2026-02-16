/**
 * Cloudflare Bot Management — read score and verified-bot from request.cf
 * Only present when Bot Management is enabled (Enterprise) for the zone.
 */

export function getBotSignals(request) {
  const bm = request.cf?.botManagement;
  if (!bm || typeof bm !== 'object') {
    return { bot_score: undefined, verified_bot: undefined };
  }

  const score = bm.score;
  const verifiedBot = bm.verifiedBot;

  return {
    bot_score:
      typeof score === 'number' && score >= 1 && score <= 99 ? score : undefined,
    verified_bot: typeof verifiedBot === 'boolean' ? verifiedBot : undefined,
  };
}
