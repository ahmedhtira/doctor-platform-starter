# Doctor Platform

Doctor presentation and appointment-booking platform — public patient booking site (French/Arabic, RTL-aware) plus a private doctor/secretary dashboard.

**Current status: M0–M9 done.** Full patient booking/self-service flow,
doctor/secretary dashboard, transactional email (Resend), appointment
outcome recording, and launch-readiness/deployment preparation are all
built and tested against **local Supabase only** — no hosted Supabase
project has been created or touched yet, and nothing has been deployed.
See [`PROJECT_SPEC.md`](PROJECT_SPEC.md) for the full schema, security
model, and milestone scope, and [`DEPLOYMENT.md`](DEPLOYMENT.md) for the
production deployment runbook and launch checklist — both are kept
current as the source of truth.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · next-intl (fr/ar, RTL) · Supabase (local Postgres + Auth, schema/RLS/functions in `supabase/migrations`) · Vitest · Playwright · ESLint · Prettier

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for the local Supabase stack — no hosted project is used in local development)

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your own Supabase project URL/keys once a Supabase project exists (see [`.env.example`](.env.example) for the required variables). No real credentials are committed anywhere in this repo — `.env.local` is gitignored.

## Local database

```bash
npm run db:start   # supabase start — local Postgres/Auth/API via Docker
npm run db:reset    # apply supabase/migrations to a fresh local database
npm run db:seed      # seed a demo doctor/secretary/clinic for manual dev use
npm run test:db      # RLS, function-permission, composite-FK, overlap tests
npm run db:stop     # supabase stop
```

`test:db` reads `TEST_SUPABASE_URL`/`TEST_SUPABASE_ANON_KEY`/
`TEST_SUPABASE_SERVICE_ROLE_KEY` from `.env.test.local` (gitignored) —
populate it from `npx supabase status` after `db:start`. This is entirely
local; nothing here ever touches a hosted Supabase project. See
[`PROJECT_SPEC.md`](PROJECT_SPEC.md) for the schema and security model.

## Available scripts

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run dev`          | Start the Next.js dev server at http://localhost:3000 (redirects to `/fr`) |
| `npm run build`        | Production build                                                           |
| `npm run start`        | Run the production build                                                   |
| `npm run lint`         | ESLint                                                                     |
| `npm run type-check`   | `tsc --noEmit`                                                             |
| `npm run format`       | Prettier — write                                                           |
| `npm run format:check` | Prettier — check only                                                      |
| `npm run test`         | Vitest unit tests (single run)                                             |
| `npm run test:watch`   | Vitest in watch mode                                                       |
| `npm run e2e`          | Playwright end-to-end tests (builds and starts the app automatically)      |
| `npm run email:process` | Manually run the M7 email worker once against `email_outbox`             |
| `npm run email:dev`    | React Email's local template preview server                                |

## Project structure

```
src/
  app/
    [locale]/                 # fr / ar locale segment (see src/i18n/routing.ts)
      layout.tsx               # root layout: <html lang dir>, next-intl provider
      (public)/                 # public patient-facing site, no auth
      (auth)/login/              # login page — never wrapped by the dashboard layout
      (dashboard)/               # doctor/secretary dashboard: auth-gated, Today/Calendar/Availability
    api/cron/process-email-outbox/ # Vercel Cron trigger for the M7 email worker (see DEPLOYMENT.md)
    robots.ts                  # crawl rules — excludes /login, /dashboard, /manage
  components/ui/               # shadcn/ui primitives
  emails/                      # React Email templates (versioned, src/emails/v1/)
  i18n/                        # next-intl routing/navigation/request config
  lib/
    supabase/                  # browser / server / service-role client factories
    email/                     # M7 outbox worker, Resend sender, template rendering
  proxy.ts                    # locale routing only — not a security boundary (Next 16's middleware.ts equivalent)
messages/
  fr.json, ar.json             # UI copy
tests/
  dashboard/, db/, booking/, email/  # Vitest, per-suite vitest.config.*.ts
  e2e/                         # Playwright
```

## Internationalization

- Locales: `fr` (default) and `ar` (RTL). English is a planned future locale — adding it does not require restructuring routes.
- `dir="rtl"`/`dir="ltr"` is set on `<html>` per locale in `src/app/[locale]/layout.tsx`.
- Use Tailwind logical properties (`ps-`, `pe-`, `ms-`, `me-`, `border-e`, etc.) instead of `left`/`right` utilities so layout stays correct in both directions.

## Notes on scope

M0–M9 cover: the full public patient site and booking flow, patient
self-service (view/cancel/reschedule via emailed single-use tokens), the
doctor/secretary dashboard (login, Today/Calendar/Availability,
appointment outcome recording), real transactional email via Resend, and
launch-readiness preparation (security headers, robots, a production
email-worker trigger, deployment/backup/smoke-test runbooks). See
[`PROJECT_SPEC.md`](PROJECT_SPEC.md) for the full milestone-by-milestone
history and every architectural decision, and
[`DEPLOYMENT.md`](DEPLOYMENT.md) for how to actually deploy this. No
hosted Supabase project has been created or touched, and nothing has been
deployed — that's the next step, not something this repo has done.
