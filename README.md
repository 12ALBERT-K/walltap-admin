# Walltap Admin

Private admin dashboard for [Walltap](https://github.com/) — deployed as a separate
site on Netlify so the admin surface is fully isolated from the public chat app.

Vanilla JS + HTML (no build step), backed by Netlify Functions that talk to the
same Supabase project as the chat app.

## What it shows

- **Overview** — user count, message count, active users (30d), posts/day and
  events-by-type charts for the last 30 days.
- **Users** — every profile with email (via the `admin_profiles` view), username
  and admin role.
- **Messages** — every post including soft-deleted ones (moderation view), with
  a live/deleted badge and the erase timestamp.

## Security model

- The browser only ever sees `SUPABASE_URL` + `SUPABASE_ANON_KEY` (`config.js`).
- Every privileged query runs in a Netlify Function with the **service role key**
  (env var only, never shipped to the browser).
- `netlify/functions/_shared/supabase.js` exports `requireAdmin(event)`, which
  verifies the caller's JWT **and** checks `profiles.is_admin = true` server-side
  before any data is returned.

## Local development

```bash
npm ci
netlify dev
```

Netlify Functions need these env vars:

| Variable | Where |
| --- | --- |
| `SUPABASE_URL` | Netlify env var (all functions + frontend) |
| `SUPABASE_ANON_KEY` | Netlify env var (frontend + token verification) |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify env var (functions only) |

For `netlify dev`, export them in your shell (or use `netlify env`). They share
the same values as the chat app's Supabase project.

## Deploy

```bash
netlify init          # create the site
netlify env:set SUPABASE_URL https://your-project-ref.supabase.co
netlify env:set SUPABASE_ANON_KEY your-anon-key
netlify env:set SUPABASE_SERVICE_ROLE_KEY your-service-role-key
git push origin main  # once the repo has a remote
```

Then open the deployed URL and sign in with the dedicated admin account created by
`npm run provision-admin` in the [chat app repo](../ROADMAP.md).

## Admin account

The admin is a **dedicated account** (`profiles.is_admin = true`) created with
`scripts/provision-admin.js` in the chat app repo. A regular user's account is
deliberately refused promotion (see ROADMAP Phase 2 §2.2).

## Notes

- Schema lives in the chat app's `server.js` (`SCHEMA_SQL`, idempotent bootstrap).
  This dashboard reads the same Supabase project; no schema lives here.
- `.netlify/` and `node_modules/` are git-ignored.