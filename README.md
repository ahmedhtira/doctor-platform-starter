# Doctor Platform

Doctor presentation and appointment-booking platform — public patient booking site (French/Arabic, RTL-aware) plus a private doctor/secretary dashboard.

**Current status: M1 — database schema, RLS, and booking functions against
local Supabase.** No UI wiring, no real email sending, no hosted project yet.
See [`PROJECT_SPEC.md`](PROJECT_SPEC.md) for the full schema, security
model, and milestone scope — it's the authoritative reference, kept current
as the source of truth.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · next-intl (fr/ar, RTL) · Supabase (local Postgres + Auth, schema/RLS/functions in `supabase/migrations`) · Vitest · Playwright · ESLint · Prettier

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for the local Supabase stack — no hosted project is used in M1)

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your own Supabase project URL/keys once a Supabase project exists (see [`.env.example`](.env.example) for the required variables). No real credentials are committed anywhere in this repo — `.env.local` is gitignored.

## Local database (M1)

```bash
npm run db:start   # supabase start — local Postgres/Auth/API via Docker
npm run db:reset    # apply supabase/migrations to a fresh local database
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

## Project structure

```
src/
  app/
    [locale]/                 # fr / ar locale segment (see src/i18n/routing.ts)
      layout.tsx               # root layout: <html lang dir>, next-intl provider
      (public)/                 # public patient-facing site, no auth
      (auth)/login/              # login page — never wrapped by the dashboard layout
      (dashboard)/               # doctor/secretary dashboard shell (placeholder, no auth guard yet)
  components/ui/               # shadcn/ui primitives
  i18n/                        # next-intl routing/navigation/request config
  lib/supabase/                # browser / server / service-role client factories
  middleware.ts                # locale routing only — not a security boundary
messages/
  fr.json, ar.json             # UI copy
tests/
  unit/                        # Vitest
  e2e/                         # Playwright
```

## Internationalization

- Locales: `fr` (default) and `ar` (RTL). English is a planned future locale — adding it does not require restructuring routes.
- `dir="rtl"`/`dir="ltr"` is set on `<html>` per locale in `src/app/[locale]/layout.tsx`.
- Use Tailwind logical properties (`ps-`, `pe-`, `ms-`, `me-`, `border-e`, etc.) instead of `left`/`right` utilities so layout stays correct in both directions.

## Notes on scope

M1 is the database layer only: schema, RLS, and the privileged booking/
cancellation/token functions, tested directly against local Supabase. It
intentionally does **not** include: any UI wiring to this schema,
authentication/login logic in the app, real transactional email sending
(rows are enqueued to `email_outbox`, not sent), or PWA functionality.
Those are covered by later milestones — see
[`PROJECT_SPEC.md`](PROJECT_SPEC.md).
