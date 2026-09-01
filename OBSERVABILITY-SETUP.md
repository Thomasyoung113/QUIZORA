# Observability Setup (PostHog + Sentry)

Both tools are wired up but **fully no-op until you add the env vars below**. Nothing breaks without them.

## Where to add

Vercel Dashboard → your QUIZORA project → Settings → Environment Variables → add for **Production + Preview**, then redeploy.

## PostHog (analytics: traffic, funnels, game events)

| Env var | Value | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_...` | posthog.com → Sign up free → Settings → Project API key |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | fixed value, use as-is |

Captured automatically: pageviews on every route. Game events: `room_create`, `room_join` (with auth status).

## Sentry (error tracking)

| Env var | Value | Where to get it |
|---|---|---|
| `SENTRY_DSN` | `https://...@o....ingest.sentry.io/...` | sentry.io → Create project (platform: Next.js) → copy DSN. Server errors use this. |
| `NEXT_PUBLIC_SENTRY_DSN` | same DSN string | same value — enables client/browser error capture |
| `SENTRY_ORG` | your org slug | sentry.io org settings (optional — only for release uploads) |
| `SENTRY_PROJECT` | project slug | sentry.io project settings (optional) |
| `SENTRY_AUTH_TOKEN` | `sntrys_...` | sentry.io → Settings → Auth Tokens (optional — release/source-map uploads) |

## Local dev

Add the same vars to `~/bghjs/.env.local` if you want to test locally. Without them, both SDKs skip init entirely.

## Verify after deploy

- PostHog: open your site, events appear in PostHog → Activity within ~30s
- Sentry: visit any 404 route, error appears in Sentry → Issues
