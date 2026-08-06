# Doctor Platform

Doctor presentation and appointment-booking platform — public patient booking site (French/Arabic, RTL-aware) plus a private doctor/secretary dashboard.

**Current status: M0 — project scaffolding only.** No database, no authentication, no booking logic, and no email sending exist yet. See [`.claude/plans` — the project plan file] for the full milestone roadmap; only the scaffolding milestone described below has been built so far.

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · next-intl (fr/ar, RTL) · Supabase (client scaffolding only for now) · Vitest · Playwright · ESLint · Prettier

## Prerequisites

- Node.js 20+ and npm
- A Supabase project (only needed once database work begins — not required to run M0)

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your own Supabase project URL/keys once a Supabase project exists (see [`.env.example`](.env.example) for the required variables). No real credentials are committed anywhere in this repo — `.env.local` is gitignored.

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

This milestone intentionally does **not** include: database migrations, Row Level Security policies, booking logic, authentication logic, transactional email, appointment-management tokens, or PWA functionality. Those are covered by later milestones in the project plan.
