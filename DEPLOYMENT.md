# Deployment & launch readiness (M9)

This is the operational counterpart to [`PROJECT_SPEC.md`](PROJECT_SPEC.md)
(architecture/security *decisions*) and [`README.md`](README.md) (local
dev setup). This file is the runbook for actually shipping the app to a
small real-world pilot: what to configure, in what order, and how to
verify it once live. **Nothing in this file has been executed as part of
M9** — no hosted Supabase project was created or touched, nothing was
deployed. It's a checklist for whoever does that next.

## Before you start

- Read [`PROJECT_SPEC.md`](PROJECT_SPEC.md)'s "Security model" and
  "Launch readiness (M9)" sections first — this document assumes that
  context and doesn't repeat it.
- Nothing here changes local development. `npm run db:start`/`db:reset`
  against local Docker Postgres continues to work exactly as before —
  this file only concerns a *separate*, hosted deployment.

## 1. Production environment variables

Every variable below is read via `requireEnv`-style getters
(`src/lib/supabase/env.ts`, `src/lib/email/env.ts`) that throw immediately
on a missing value — **except** `EMAIL_FROM_ADDRESS` and `APP_URL`, which
silently fall back to development defaults (`onboarding@resend.dev`,
`http://localhost:3000`) if left unset. Set every one of these explicitly
in your hosting platform's environment variable settings before going
live — do not rely on any fallback in production.

| Variable | Secret? | Where it's read | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | No (public by design) | `src/lib/supabase/env.ts` | The hosted project's API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No (RLS-governed) | `src/lib/supabase/env.ts` | The hosted project's anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | `src/lib/supabase/env.ts` | Bypasses RLS entirely — server-only, verified never reachable from client code (see audit note below) |
| `RESEND_API_KEY` | **Yes** | `src/lib/email/env.ts` | From your Resend account |
| `EMAIL_FROM_ADDRESS` | No | `src/lib/email/env.ts` | **Must** be set to a verified-domain address in production — see §3. Falls back silently to Resend's sandbox sender if unset |
| `APP_URL` | No | `src/lib/email/env.ts` | **Must** be your real production origin (e.g. `https://your-domain.com`). A wrong/unset value silently embeds broken `localhost` management links in every patient email |
| `EMAIL_TOKEN_DERIVATION_KEY` | **Yes** | `src/lib/email/env.ts` | Generate via `openssl rand -hex 32`. **Stability warning already documented in `.env.example` applies in production too**: never rotate this while any retriable `email_outbox` row exists |
| `CRON_SECRET` | **Yes** | `src/app/api/cron/process-email-outbox/route.ts` | New in M9 — only needed if using the Vercel Cron trigger (§5). Generate via `openssl rand -hex 32` |

**Verified during M9's audit, not just assumed:** every one of these is
documented here and in `.env.example`; nothing is read anywhere in `src/`
or `scripts/` that isn't listed; no secret is ever read through a
`NEXT_PUBLIC_`-prefixed name or passed as a client-component prop
(grepped all `"use client"` files — zero matches); `.gitignore`'s `.env*`
pattern has never let a real secret reach git history (`git log --all`
checked). `createServiceRoleClient()` is only ever imported from Server
Actions, one server-only page load, one server-only lib, the two worker
entry points (`scripts/process-email-outbox.ts`, the new cron Route
Handler), and tests — never from anything that ships to the browser.

## 2. Hosted Supabase setup

1. Create a new Supabase project. Note its Postgres major version — it
   must match `supabase/config.toml`'s `major_version = 17` (or update
   that file if the hosted project uses a newer major version).
2. Link this repo to it: `supabase link --project-ref <your-project-ref>`.
3. Apply every migration in order: `supabase db push`. This runs the
   exact same `supabase/migrations/*.sql` files already tested against
   local Docker — the schema, RLS policies, and privileged functions are
   the source of truth, not a separately-maintained hosted config.
4. In the hosted project's Auth settings (dashboard or, if you use
   declarative config push, `supabase/config.toml`'s `[auth]` section),
   set the **Site URL** and **Redirect URLs** to your real production
   domain — `supabase/config.toml`'s current `http://127.0.0.1:3000`
   values are local-CLI-only and don't apply to a hosted project.
5. From the hosted project's API settings, copy the project URL, anon
   key, and service role key into your hosting platform's environment
   variables (§1) — never into a committed file.
6. Regenerate `src/lib/supabase/database.types.ts` against the linked
   project if its schema ever diverges from what's committed (it
   shouldn't, since `db push` is the only way schema changes reach it):
   `supabase gen types typescript --linked > src/lib/supabase/database.types.ts`.
7. Do **not** run `npm run db:seed` against the hosted project —
   `scripts/seed-doctor.ts` is dev/demo fixture data, not a production
   onboarding tool. Provisioning real doctors on a hosted project is
   out of scope for M9 (no self-service doctor signup exists yet — see
   `PROJECT_SPEC.md`'s Product model).

## 3. Resend / email domain configuration

1. In the Resend dashboard, add and verify a custom sending domain (SPF,
   DKIM, and ideally DMARC DNS records). Resend's default/sandbox sender
   (`onboarding@resend.dev`) has real sending restrictions and is not
   suitable for delivering mail to actual patients.
2. Set `EMAIL_FROM_ADDRESS` (§1) to an address on that verified domain,
   e.g. `"Your Clinic <notifications@your-domain.com>"`.
3. Set `APP_URL` (§1) to your real production origin — every management
   link embedded in every email is built from this value
   (`src/lib/email/process-email-outbox.ts`).
4. Set `CRON_SECRET` if using the automated trigger below.

## 4. Cron trigger for the email worker — REQUIRED, read carefully

**Without this, `email_outbox` rows are enqueued but never sent in
production.** M7 built `email_outbox` and the Resend-sending worker
(`processEmailOutbox`, `src/lib/email/process-email-outbox.ts`); M9 adds
the one thing that was missing — something that actually *calls* it on a
schedule. Two options, both fully built:

### Option A — Vercel Cron (automated, recommended if deploying to Vercel)

`vercel.json` (committed) already configures:

```json
{ "crons": [{ "path": "/api/cron/process-email-outbox", "schedule": "*/5 * * * *" }] }
```

`src/app/api/cron/process-email-outbox/route.ts` is a thin Route Handler
that checks the `CRON_SECRET` (§1) against the `Authorization: Bearer
<secret>` header Vercel automatically attaches to every cron invocation
(pattern verified live against
[vercel.com/docs/cron-jobs/manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
while designing this, not assumed), then calls the exact same
`processEmailOutbox()` DI-core the manual script uses — zero duplicated
or reimplemented logic.

**Vercel plan tier requirement — this is not optional, read before
deploying:**

- The `*/5 * * * *` schedule committed in `vercel.json` **requires
  Vercel Pro or higher**.
- **Vercel Hobby only permits cron jobs to run once per day.** A
  more-frequent expression like `*/5 * * * *` will be **rejected at
  deploy time** on Hobby — the deployment will fail, not silently
  degrade.
- **For this product, once-daily email processing is not acceptable for
  a real pilot** — a patient booking an appointment expects a
  confirmation email within minutes, not up to 24 hours later. Do not
  "solve" a Hobby-tier deploy failure by loosening `vercel.json`'s
  schedule to `0 0 * * *` (or similar) and calling it done; that
  silently breaks the actual product experience M7 was built for.
- Before deploying, choose explicitly:
  - **(A) Upgrade to Vercel Pro** (or higher) and keep the committed
    5-minute schedule as-is, or
  - **(B) Replace Vercel Cron with a different, sufficiently frequent
    scheduler** hitting the same endpoint — e.g. an external cron
    service (cron-job.org, GitHub Actions on a schedule, a small VM's
    system cron) issuing `curl -H "Authorization: Bearer $CRON_SECRET"
    https://your-domain.com/api/cron/process-email-outbox` every few
    minutes. The Route Handler and its auth check work identically
    regardless of what triggers them — nothing about the endpoint
    itself is Vercel-specific.
  - Manual triggering (`npm run email:process`, unchanged since M7) also
    still works as a stopgap or a supplement, but should not be the
    *only* mechanism for a live pilot with real patients depending on
    timely confirmation emails.

### Concurrency and duplicate-invocation safety

Vercel's own cron documentation states delivery is "best effort" and can
occasionally invoke the same schedule more than once, or overlap a
slow-running invocation with the next one — and recommends idempotent,
lock-protected design as a result. **No additional lock (Redis or
otherwise) was added for M9, deliberately** — the existing M7 claim/lease
architecture already provides exactly the safety this requires, at the
database level, regardless of how many times or how concurrently the
endpoint is invoked:

- `pending -> processing` claiming via `claim_email_outbox_batch`'s
  `for update skip locked` — two overlapping invocations get disjoint
  row sets, never the same row twice at once.
- Each claimed row is stamped with a `claim_token`; every finalizing
  write is conditioned on still owning that token, so a lease lost to
  staleness recovery can't be double-finalized.
- Stale-lease recovery (`p_stale_after_minutes`) reclaims rows from a
  crashed or timed-out invocation automatically — no manual intervention
  needed if one cron run gets killed mid-batch.
- Resend's own idempotency key (`doctor-platform-email/<email_outbox_id>`,
  stable across retries) means even a genuine duplicate *send attempt*
  from two overlapping invocations racing past the row-lock (shouldn't
  happen given the above, but as defense in depth) doesn't produce a
  duplicate email — Resend recognizes the repeated key and returns the
  original response.

See `PROJECT_SPEC.md`'s "Transactional email delivery (M7)" section for
the full mechanism. This is documented here because M9 is the first time
something (Vercel Cron) can actually invoke the worker concurrently with
itself in production — M7 built the safety, M9 is confirming it already
covers this specific new caller.

## 5. Vercel deployment

1. Import the repo into Vercel. No special build configuration needed —
   `next build`/`next start` (unchanged `package.json` scripts), no
   `output: "standalone"` required (that's for self-hosted/Docker
   targets, not Vercel).
2. Set every environment variable from §1 in the Vercel project settings
   (Production environment at minimum; add to Preview too if you want
   preview deployments to send real email — usually you don't, in which
   case leave `RESEND_API_KEY`/`CRON_SECRET` unset there so preview
   builds simply fail to send rather than emailing real patients from a
   preview URL).
3. Confirm `vercel.json`'s cron tier requirement (§4) before the first
   production deploy.
4. Deploy. Vercel provisions HTTPS and applies `Strict-Transport-Security`
   automatically for custom domains — verified as part of the smoke test
   below, not asserted redundantly in application code.

## 6. Backup & recovery

- **Schema recovery**: `supabase/migrations/*.sql` is the source of
  truth. A fresh hosted project can be fully rebuilt via `supabase link`
  + `supabase db push` (§2) — this has already been exercised repeatedly
  against local Docker throughout M1–M8.
- **Data backup**: enable point-in-time recovery (or confirm your plan
  tier's included backup frequency) on the hosted Supabase project once
  created. This is a hosted-project dashboard setting, not something
  this repo configures.
- **Secrets backup**: store `EMAIL_TOKEN_DERIVATION_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` somewhere durable outside just Vercel's env
  var store (e.g. a password manager) — losing `EMAIL_TOKEN_DERIVATION_KEY`
  specifically and needing to regenerate it silently invalidates every
  not-yet-sent email's management link (bounded blast radius: the 23h
  provider-idempotency window means this only affects genuinely in-flight
  retries, not historical sent mail, but it's still worth avoiding).
- **Recovery drill** (recommended before relying on this in a real
  pilot): create a second hosted project, run `supabase db push` against
  it, confirm RLS/privileged-function behavior matches (`npm run
  test:db`/`test:booking`/`test:dashboard`/`test:email` can be pointed at
  it temporarily via a throwaway `.env.test.local`, then discarded —
  never point them at your real production project).

## 7. Logging & error monitoring

M9 adds `console.error` at every Server Action's previously-silent
unexpected-error path (not classified business-rule rejections like "slot
no longer available" — just genuine unhandled failures) and at every
`availability/actions.ts` Supabase-error early-return, which previously
had zero visibility at all. Vercel captures all `console.*` output as
function logs automatically — no new dependency, no DSN to provision.

This is intentionally the pilot-scale floor, not a ceiling: no error-
monitoring SaaS (Sentry or similar) was wired up in M9. If/when real
usage grows past what's comfortable to monitor via raw log tailing,
revisit this — but that's a future milestone's decision, not assumed
here.

## 8. Security headers, cookies, robots — already verified, no action needed

Audited during M9 planning and found already correct, or fixed as part of
this milestone's code changes:

- Platform-wide `X-Content-Type-Options: nosniff` and `X-Frame-Options:
  DENY` (new, `next.config.ts`), alongside `/manage`'s pre-existing
  stricter `Cache-Control`/`Referrer-Policy`/`X-Robots-Tag` block
  (unchanged). No Content-Security-Policy — deliberately out of scope,
  see `PROJECT_SPEC.md`.
- `src/app/robots.ts` (new) disallows `/*/login`, `/*/dashboard`,
  `/*/manage` for all crawlers; the public patient-facing site stays
  discoverable.
- Every cookie in the app (`manage_session` and Supabase's own auth
  cookie) already matches `PROJECT_SPEC.md`'s documented settings —
  verified, not changed.
- RLS policies and table/function grants across every migration were
  fully inventoried and cross-checked against `PROJECT_SPEC.md`'s
  "Security model" — no drift found, nothing broader than documented.

## 9. Production smoke test

Run this manually, end to end, against the real deployed app after
setup — in **both** `fr` and `ar` (checking RTL layout throughout the
Arabic pass), using a real inbox, not a mocked sender:

1. **Public discovery** — homepage search (specialty/city filters),
   result cards, doctor profile page. Confirm `/robots.txt` reflects the
   expected disallow list and `/fr`/`/ar` are both reachable.
2. **Booking** — pick a real future slot, submit the booking form,
   confirm the on-screen confirmation and management link.
3. **Email** — confirm the booking-confirmation email actually arrives
   (via the cron trigger or a manual `npm run email:process`, per §4's
   choice), check its `From` address (should be your verified domain,
   not the sandbox default), its content in the locale you booked in,
   and that its management link works.
4. **Patient management** (`/manage`) — redeem the token from the email,
   view the appointment, cancel or reschedule it, confirm the
   cancellation/reschedule email arrives with a working (rotated, for
   reschedule) management link. Confirm `/manage` still serves
   `Cache-Control: no-store`/`no-referrer`/`noindex` headers (verify via
   browser devtools' Network tab against the live production URL).
5. **Staff dashboard** — log in as a doctor/secretary, confirm Today/
   Calendar/Availability all load, staff-initiated cancel/reschedule
   works and emails the patient, mark a past appointment
   completed/no-show.
6. **Headers spot-check** — via browser devtools or `curl -I`, confirm
   `X-Content-Type-Options`/`X-Frame-Options` appear on a public route,
   and that the deployed domain shows `Strict-Transport-Security`
   (Vercel-provided, not application code — confirms §5's assumption
   held).
