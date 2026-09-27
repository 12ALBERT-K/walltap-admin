# Walltap Admin

Private admin dashboard for Walltap — deployed as a separate site on Netlify so
the admin surface is fully isolated from the public chat app.

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

- The browser only ever sees `SUPABASE_URL` + `SUPABASE_ANON_KEY`, and it reads
  them from **`config.js` in this repo** — *not* from Netlify env vars. If you
  rotate the anon key or repoint the site at a different Supabase project you
  must update `config.js` too, or the browser will sign in against one project
  while the functions validate tokens against another.
- Every privileged query runs in a Netlify Function with the **service role key**
  (env var only, never shipped to the browser). It is referenced in exactly one
  place, `netlify/functions/_shared/supabase.js`.
- `netlify/functions/_shared/supabase.js` exports `requireAdmin(event)`, which
  verifies the caller's JWT with Supabase GoTrue **and** checks
  `profiles.is_admin = true` server-side before any data is returned. It is the
  first statement in every privileged function.
- `admin_profiles` (the view that exposes `auth.users.email`) has RLS revoked
  from `anon`/`authenticated` and is granted to `service_role` only, so the user
  list is not readable with the public anon key.
- `profiles` grants `UPDATE (username)` only — a signed-in user cannot set
  `is_admin` on their own row, even with a valid JWT.
- `netlify.toml` sets a CSP (no `unsafe-inline` in `script-src`), `frame-ancestors
  'none'`, `nosniff`, `no-referrer`, and `Cache-Control: no-store` on function
  responses, since those carry every email and every message.
- There is no build command. That is deliberate: it means Netlify performs no
  env-var substitution at build time, so the service role key cannot be inlined
  into a published asset. Do not add a build step or a plugin that injects env
  vars into HTML.

## Local development

```bash
npm ci
npm install -g netlify-cli   # not a devDependency — `netlify` is not on PATH otherwise
netlify dev
```

Netlify Functions need these env vars:

| Variable | Where |
| --- | --- |
| `SUPABASE_URL` | Netlify env var — functions only |
| `SUPABASE_ANON_KEY` | Netlify env var — functions only (token verification) |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify env var — functions only |
| *(anon key + URL for the browser)* | `config.js`, committed in this repo |

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

Then open the deployed URL and sign in with the dedicated admin account created
by `npm run provision-admin` **in the chat app repo** (that script does not exist
in this repository — it lives next to the app's `server.js`).

After deploying, confirm the deployed function list is exactly
`list-users`, `list-all-messages` and `analytics-summary`. Anything else —
especially anything starting with `_` — means a stray file got bundled.

## Known limitations

These are real and unfixed — do not treat the dashboard as complete data until
they are addressed:

- **Lists truncate silently at 1000 rows.** `list-users` and `list-all-messages`
  have no `.limit()`/`.range()`, so PostgREST's `max-rows` ceiling applies. Once
  the board passes 1000 posts the Messages tab shows only the newest 1000 and
  gives no indication that anything is missing — which matters, because that tab
  is the moderation view. `list-users` is affected the same way, so an older
  admin account can become invisible.
- **`posts` and `post_files` are fetched independently**, so a post near the
  boundary can come back with a partial attachment list.
- **"Posts per day" is capped at 200 rows** but labelled "last 30 days", so the
  chart under-counts once the board passes 200 posts in the window.
- **`event_type` is user-writable** and rendered as a chart label, so label text
  is escaped and length-clamped; do not remove that escaping.

## Admin account

The admin is a **dedicated account** (`profiles.is_admin = true`) created with
`scripts/provision-admin.js` in the chat app repo. A regular user's account is
deliberately refused promotion (see ROADMAP Phase 2 §2.2).

## Notes

- Schema lives in the chat app's `server.js` (`SCHEMA_SQL`, idempotent bootstrap).
  This dashboard reads the same Supabase project; no schema lives here.
- `.netlify/` and `node_modules/` are git-ignored.