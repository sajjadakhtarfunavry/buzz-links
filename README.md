# buzz-link-edge

Cloudflare Worker for **Buzz Links** short URLs: `GET https://bzz.link/{slug}` → resolve link, set session cookie, enqueue click event, redirect to destination with attribution params.

This repo is the **edge only** (Worker + KV + Queue). The backend (link generation, webhook API, click processing, ledger) lives in the Launchpad Backend repo.

---

## What it does

- **Redirect:** User hits `bzz.link/{slug}` → Worker resolves slug (KV cache or backend webhook), sets `buzz_sid` cookie, enqueues a click event, returns 302 to destination with `buzz_sid`, `buzz_cid`, `buzz_lid` in the URL.
- **Click ingest:** Queue consumer receives batches and POSTs each click to the backend webhook. Backend qualifies the click and mints points (no logic in this repo).
- **Optional:** Rate limiting (KV), Cloudflare Bot Management signals (`bot_score`, `verified_bot`) passed through to the backend.

---

## Prerequisites

- **Node.js** 20+ (required by Wrangler 4)
- **Cloudflare account** and a zone for your short-link domain (e.g. bzz.link, proxied)
- **Backend** exposing the [Buzz Links Webhook API](#backend-api) (resolve by slug + click ingest)

---

## Quick start

```bash
git clone https://github.com/ChainGPT-org/pad-buzz-worker
cd pad-buzz-worker
yarn install
```

Copy **`.env.example`** to **`.env`** and set your values (see [How env is loaded](#how-env-is-loaded)). Both `.env` and `.dev.vars` are gitignored.

```bash
cp .env.example .env
# edit .env with your BACKEND_FALLBACK_URL and BUZZ_LINKS_WEBHOOK_SECRET
yarn dev       # local: http://localhost:8787
```

Then open `http://localhost:8787/your-slug` (or your dev URL). Deploy when ready:

```bash
yarn deploy
```

---

## Project structure

```
bzz-link-edge/
├── src/
│   ├── index.js           # Entry: fetch + queue handlers
│   ├── constants.js       # Cookie, KV, webhook paths, timeouts
│   ├── utils.js           # Log, hash, cookie, session, IDs
│   ├── redirect-handler.js # GET /{slug} → resolve, enqueue, 302
│   ├── queue-handler.js   # Consume queue → POST to backend webhook
│   ├── backend.js         # fetchLinkFromBackendWebhook (resolve slug)
│   ├── bot-signals.js     # Read request.cf.botManagement (score, verifiedBot)
│   ├── rate-limit.js      # KV-based per-IP rate limiting
│   └── ...
├── wrangler.toml          # Worker name, KV/Queue bindings, vars
├── package.json
├── .env                   # Local env (gitignored)
└── README.md
```

---

## Configuration

### Environment / secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_FALLBACK_URL` | Yes | Backend base URL, no trailing slash (e.g. `https://api.example.com`). Used for link resolve and click webhook. |
| `BUZZ_LINKS_WEBHOOK_SECRET` | Yes | Same value as backend; sent as `X-API-Key` with `X-Source: buzz_links`. |
| `EDGE_IP_HASH_SALT` | No | Salt for hashing IPs in payloads/logs. Default used if unset. |
| `FF_V2_BUZZ_LINKS` | No | Feature flag, default `true`. |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | No | Only used when `RATE_LIMIT_KV` is bound; default `100`. |

See **`.env.example`** for a template. Copy it to `.env` or `.dev.vars` and fill in values.

### How env is loaded

| Where | How env is loaded |
|-------|-------------------|
| **Local (`yarn dev`)** | Wrangler reads **`.dev.vars`** if it exists; otherwise it can use **`.env`** (in recent Wrangler). Use one file with `KEY=value` per line. These files are gitignored — never commit secrets. |
| **Production (deployed Worker)** | Values come from **(1)** `[vars]` in `wrangler.toml` (non-secret, e.g. `FF_V2_BUZZ_LINKS`) and **(2)** **secrets** set in the Cloudflare dashboard (Workers → your Worker → Settings → Variables and Secrets) or via `npx wrangler secret put SECRET_NAME`. The Worker receives them as the `env` object at runtime. |
| **GitHub Actions deploy** | The workflow only runs `wrangler deploy`. It does **not** inject env into the Worker. Production secrets must already be set in the Cloudflare account (dashboard or a one-time `wrangler secret put` from your machine). The workflow needs only **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`** in GitHub (for deploy permission). |

**Summary:** Local = `.env` or `.dev.vars`. Production = Cloudflare dashboard (or `wrangler secret put`) + `wrangler.toml` [vars].

### wrangler.toml

- **KV:** `LINKS_KV` (link cache), optionally `RATE_LIMIT_KV` (rate-limit counters). Create namespaces with `yarn kv:create` and `yarn kv:create-ratelimit`, then set the returned IDs in `wrangler.toml`.
- **Queue:** `CLICKS_QUEUE` (producer + consumer). Create with `yarn queue:create` and wire the queue name in `wrangler.toml`.
- **Route:** After first deploy, in Cloudflare dashboard add a route (e.g. `bzz.link/*`) to this Worker.

---

## Setup checklist

1. **Clone and install** (see Quick start).
2. **Copy `.env.example` to `.env`** and set `BACKEND_FALLBACK_URL` and `BUZZ_LINKS_WEBHOOK_SECRET`.
3. **KV (link cache):** `yarn kv:create` → add `id` to `wrangler.toml` under `[[kv_namespaces]]` with `binding = "LINKS_KV"`.
4. **KV (rate limit, optional):** `yarn kv:create-ratelimit` → add binding `RATE_LIMIT_KV` in `wrangler.toml`.
5. **Queue:** `yarn queue:create` → ensure `[[queues.producers]]` and `[[queues.consumers]]` in `wrangler.toml` use the same queue name and `binding = "CLICKS_QUEUE"`.
6. **Deploy:** `yarn deploy`.
7. **Route:** In Cloudflare dashboard, Workers → this Worker → Triggers → add route (e.g. `bzz.link/*`).
8. **Secrets in production:** Set `BACKEND_FALLBACK_URL` and `BUZZ_LINKS_WEBHOOK_SECRET` via dashboard or `wrangler secret put`.

---

## Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Local dev server (Wrangler). |
| `yarn deploy` | Deploy Worker to production. |
| `yarn deploy:dev` | Deploy Worker to development. |
| `yarn tail` | Stream live logs. |
| `yarn kv:create` | Create KV namespace for link cache. |
| `yarn kv:create-ratelimit` | Create KV namespace for rate limiting. |
| `yarn queue:create` | Create Queue for click events (production). |
| `yarn queue:create-dev` | Create Queue for development (required before first dev deploy). |

---

## Deployment

### Environments

| Branch       | Worker                   | URL                                      |
|-------------|---------------------------|------------------------------------------|
| `main`      | buzz-links-redirect       | `buzz-links-redirect.<account>.workers.dev` |
| `development` | buzz-links-redirect-dev | `buzz-links-redirect-dev.<account>.workers.dev` |

**Before first dev deploy:** run `yarn queue:create-dev` to create the dev queue (`buzz-link-clicks-dev`). Each queue can have only one consumer, so dev uses a separate queue.

### Option 1: Manual (local)

```bash
yarn deploy        # production
yarn deploy:dev    # development
```

Uses your local Wrangler login and `wrangler.toml`. Good for one-off or solo deploys.

### Option 2: GitHub Actions (recommended)

Deploy automatically on push to `main` (production) or `development` (dev).

1. In **Cloudflare dashboard**: My Profile → API Tokens → Create Token → use “Edit Cloudflare Workers” template. Copy the token.
2. In **GitHub**: repo → Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN` = the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID` = your Cloudflare account ID (dashboard URL or Workers overview)
3. Push to `main` (production) or `development` (dev), or run the “Deploy” workflow manually from the Actions tab.

The workflow is in **`.github/workflows/deploy.yml`**. Worker **secrets** (`BACKEND_FALLBACK_URL`, `BUZZ_LINKS_WEBHOOK_SECRET`, etc.) are not in GitHub; set them once in the Cloudflare dashboard (Workers → your Worker → Settings → Variables and Secrets) or via `wrangler secret put` locally.

### Option 3: Cloudflare Git integration

In **Cloudflare dashboard**: Workers & Pages → Create application → Connect to Git (GitHub/GitLab). Connect this repo and configure build (e.g. build command: `yarn build` or leave default; Wrangler will build). Cloudflare will build and deploy on every push. No GitHub Actions needed; secrets are configured in the dashboard.

---

## Backend API

This Worker talks to the **Buzz Links Webhook API** only.

### 1. Resolve by slug

- **Request:** `GET {BACKEND_FALLBACK_URL}/webhook/buzz-links/resolve/:slug`
- **Headers:** `X-API-Key: <BUZZ_LINKS_WEBHOOK_SECRET>`, `X-Source: buzz_links`
- **Response 200:** `campaign_id`, `link_id`, `destination_url`, `wallet_address`, `status`
- **404:** Slug not found or link inactive.

Used when the slug is not in KV cache.

### 2. Click ingest

- **Request:** `POST {BACKEND_FALLBACK_URL}/webhook/buzz-links/click`
- **Headers:** `Content-Type: application/json`, `X-API-Key`, `X-Source: buzz_links`
- **Body:** `click_event_id`, `campaign_id`, `link_id`, `wallet_address`, `session_id`, `ip_hash` (required); `ua_hash`, `country_code`, `ts`, `bot_score`, `verified_bot`, `owner_user_id` (optional)
- **Response 202:** Accepted (backend enqueues job).

The **queue consumer** in this Worker POSTs each queued click to this endpoint. The redirect path only enqueues; it does not call the backend directly.

---

## Observability

- **Logs:** `yarn tail` or Workers Logpush. Events: `buzzlink_redirect_received`, `buzzlink_redirect_success`, `buzzlink_redirect_not_found`, `buzzlink_event_enqueued`, `buzzlink_event_enqueue_failed`, `buzzlink_event_skipped` (reason: head_probe, range_probe, prefetch_or_preload, sec_fetch_*), `buzzlink_rate_limited`; consumer: `buzzlink_consumer_acked`, `buzzlink_consumer_retry`, `buzzlink_consumer_skip`.
- **Metrics:** Cloudflare Analytics / Workers Analytics.
- **Alerts:** Consider 5xx and enqueue-failure spikes.

---

## Docs (in repo)

- **`docs/BOT-MANAGEMENT.md`** — How Bot Management is used (pass `bot_score` / `verified_bot` to backend).
- **`docs/WAF-AND-BOT-MANAGEMENT.md`** — WAF vs Bot Management and what Buzz Links expects.

---

## License / PRD

Private project. Full PRD: Launchpad Backend repo → `docs/PRD-Buzz-Links-Cloudflare-Edge-Server.md` (or equivalent).
