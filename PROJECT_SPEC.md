# Project spec — authoritative architecture reference

This document exists because an earlier plan file was never committed to
the repo, which let a later session start reconstructing the schema from
scratch and drift from decisions that had already been made. **This file is
now the source of truth for schema, security model, and milestone scope.**
Read it before changing the database layer. If a decision here needs to
change, update this file in the same change — don't let it go stale again.

## Milestones

- **M0** (done): Next.js scaffold, i18n (fr/ar, RTL), Supabase client
  factories, no database.
- **M1** (done): database schema, RLS, and the privileged
  booking/cancellation/token functions, against **local Supabase only**.
  No UI wiring, no real email sending, no hosted project.
- **M2** (done): the public doctor profile page (`/doctors/[slug]`) reading
  real data through the public RLS policies, plus the platform's visual
  design system (tokens, typography, base components) established on that
  page. fr/ar with RTL. No booking, no availability, no dashboard.
- **M2.5** (this milestone): the public patient-facing homepage — real
  doctor search with specialty/city filtering and result cards, reading
  from local Supabase. Doctor/secretary login demoted out of the primary
  patient nav (moved to a subtle footer link) to keep the staff workspace
  a separate, desktop-first flow, not mixed into patient browsing. Still
  no booking, no availability.
- **M3+**: not started. Don't infer scope for it from this file.

## Product model

Multi-doctor marketplace: many independent doctors, each with their own
public profile, one or more clinics, their own schedule, and zero or more
secretaries. A secretary may work for more than one doctor
(`doctor_secretaries` is many-to-many). Patients have **no** account or
auth in M1 — appointments capture patient name/phone/email directly;
post-booking self-service (view/cancel/reschedule) is via emailed,
single-use management tokens, not login.

Bookable time is **not** a pre-generated slots table. Doctors define
recurring `working_hours` and `breaks` per clinic per weekday, `date`-level
`schedule_exceptions` (close a normally-open date, open a normally-closed
one, or substitute custom hours), and `blocked_periods` (vacations, etc.).
Available slots are computed on demand by `compute_available_slots()`.
`appointments.starts_at`/`ends_at` are `timestamptz`; a GiST exclusion
constraint is the final, authoritative no-overlap guarantee — everything
upstream of it (slot computation, function-level validation) is a UX
convenience, not the safety mechanism.

All wall-clock schedule data (working hours, breaks, exceptions) is
interpreted in the **clinic's** IANA timezone (`clinics.timezone`), not the
doctor's — a doctor with clinics in two cities has two timezones in play.
`doctors.timezone` is the doctor's own default/display timezone.

## Security model

Two enforcement layers, deliberately not merged:

1. **RLS** governs direct reads/writes made by a logged-in doctor or
   secretary through the normal Supabase client (dashboard use), and public
   reads of published-doctor content. Row visibility/mutation is decided by
   `private.is_staff_for_doctor(auth.uid(), doctor_id)` — true if the caller
   is that doctor (`doctors.user_id`) or one of their secretaries
   (`doctor_secretaries`).
2. **Privileged functions** are the *only* path for anything that creates,
   cancels, or reschedules an appointment, or that touches a management
   token — for staff and patients alike. These are `SECURITY DEFINER`,
   `REVOKE`d from `PUBLIC`/`anon`/`authenticated`, and `GRANT`ed to
   `service_role` only. They're called exclusively from trusted Next.js
   server routes/actions using `createServiceRoleClient()`
   ([src/lib/supabase/service-role.ts](src/lib/supabase/service-role.ts)).
   Because a service_role call carries no `auth.uid()`, these functions take
   an explicit actor parameter (a secretary/doctor user id, or a redeemed
   management session id) that the server supplies only after it has
   authenticated the caller itself. `appointments` has **no** RLS
   INSERT/UPDATE/DELETE policy at all — this is intentional, not an
   oversight, so there is exactly one write path.

Helper functions used *inside* policies (`private.is_staff_for_doctor`,
`private.is_doctor_owner`) live in a separate `private` Postgres schema that
is excluded from `api.schemas` in `supabase/config.toml`, so it is
unreachable via PostgREST/`.rpc()` regardless of grants — it exists only to
be called from other SQL. They are `SECURITY DEFINER` with
`SET search_path = ''` and fully-qualified references, which is what lets
them read `doctors`/`doctor_secretaries` without the recursive RLS
evaluation a plain `SECURITY INVOKER` helper would hit.

The privileged operational functions (`book_appointment`,
`compute_available_slots`, etc.) live in `public`, *not* `private`, even
though they're locked to `service_role` — `.rpc()` only reaches
`public`/`graphql_public`, so a `private`-schema function would be
unreachable from a server action no matter what it's granted.

**Raw management tokens never reach Postgres.** They're generated with
`crypto.randomBytes` in Next.js server code; only the SHA-256 hash is
passed into `book_appointment`/`create_management_token`. No function or
policy ever selects `token_hash` back out to anon/authenticated.

`working_hours`, `breaks`, `blocked_periods`, and `schedule_exceptions` are
never exposed to `anon` — public availability is derived exclusively
through `compute_available_slots()`.

Note: this CLI's local Postgres defaults to **not** auto-exposing new
tables to `anon`/`authenticated` (`auto_expose_new_tables` is unset in
`supabase/config.toml`). Every table that needs client access has an
explicit `GRANT` in its migration — don't assume a new table is reachable
without one.

## Schema

| Table | Purpose |
| --- | --- |
| `supported_locales` | fr/ar lookup (matches `next-intl` routing) |
| `specialties` | bilingual specialty lookup |
| `doctors` | `id` (internal PK) separate from `user_id` (→ `auth.users`); `timezone`, `is_published`, `min_booking_notice_minutes` |
| `clinics` | `doctor_id` FK, own `timezone`, nullable `city` (added in M2.5 for search filtering — nullable so it's additive to already-tested M1 fixtures/functions, not a breaking change); `UNIQUE(doctor_id, id)` for composite FKs |
| `doctor_secretaries` | M2M junction, `(doctor_id, secretary_user_id)` PK |
| `appointment_types` | `doctor_id` FK, `duration_minutes`; `UNIQUE(doctor_id, id)` |
| `working_hours` | recurring weekly rule per `(doctor_id, clinic_id, day_of_week)` |
| `breaks` | recurring weekly break windows, multiple per day allowed |
| `blocked_periods` | one-off blocks; `clinic_id` nullable = doctor-wide |
| `schedule_exceptions` | per-`(doctor_id, clinic_id, date)` override (closed / opened / custom hours) |
| `appointments` | core record; composite FKs to `clinics`, `appointment_types`, `doctor_secretaries`; GiST exclusion on `(doctor_id, tstzrange(starts_at, ends_at))` where `status = 'confirmed'`; status ∈ `confirmed, cancelled, completed, no_show` |
| `appointment_management_tokens` | hashed single-use patient self-service token |
| `appointment_management_sessions` | short-lived session created when a token is redeemed |
| `doctor_qualifications`, `doctor_publications`, `doctor_books`, `doctor_media_appearances` | public-profile content, one-to-many on `doctor_id` |
| `email_outbox` | queued transactional email; enqueued by privileged functions, sending itself is a later milestone |
| `audit_log` | write-only-by-function record of privileged actions |

## Functions

- `private.is_doctor_owner`, `private.is_staff_for_doctor` — RLS helpers.
- `public.compute_available_slots(doctor_id, clinic_id, appointment_type_id, local_date, now)` — derives bookable slots from exceptions → working hours → breaks → blocked periods → existing confirmed appointments → minimum booking notice. `now` is a parameter (not `now()`) so lead-time behavior is deterministic in tests.
- `private.is_within_working_window(doctor_id, clinic_id, starts_at, ends_at)` — the same exceptions/working-hours/breaks/blocked-periods resolution as `compute_available_slots`, but as a single boolean check for one candidate range. Called from `book_appointment` and `reschedule_appointment` so a write is rejected, not just hidden from the public slot list, if it falls outside working hours or inside a blocked period. Internal-only (revoked from every role, including `service_role`) — it's only ever called from within those two `SECURITY DEFINER` functions, which already run as the definer.
- `public.book_appointment`, `public.cancel_appointment`, `public.reschedule_appointment` — the only way to mutate `appointments`. Both `cancel_appointment` and `reschedule_appointment` require the appointment's current status to be `confirmed` (errcode `55000` otherwise) — repeat cancellation/reschedule of an already-cancelled/completed/no_show appointment is rejected, not silently re-applied. `reschedule_appointment` also invalidates (`used_at = now()`) any outstanding management tokens for that appointment on a successful reschedule, and can atomically issue a replacement via an optional `p_new_management_token_hash`.
- `public.create_management_token`, `public.redeem_management_token` — token issuance/redemption, hash-only. `redeem_management_token` uses one generic error (`42501`, "invalid or expired token") for an unknown, expired, already-used, or reschedule-invalidated token — it never reveals which case applies.

All five `public` functions above: `service_role` execute only.

## Public doctor search (M2.5)

The homepage reads all published doctors (with their specialty and clinics
embedded) in one RLS-bound anon query, then derives filter options and
applies the `specialty`/`city` filters **in memory**, not as separate
PostgREST queries — deliberately, given the current scale (a handful of
seeded doctors). Filters are plain URL search params
(`?specialty=slug&city=Tunis`) submitted via a native `<form method="get">`
with a real submit button — no client JS, no `"use client"` component,
works with JS disabled. If the doctor directory grows enough for this to
matter, move filtering into the query (e.g. `clinics!inner` embedded
filters) as a later-milestone optimization — not needed yet.

## Local-only guardrail

Nothing in M1 touches a hosted Supabase project. Migrations apply only via
`supabase db reset` against the local Docker stack; tests read
`TEST_SUPABASE_*` env vars pointed at `127.0.0.1` from a gitignored
`.env.test.local`, never `.env.local`.
