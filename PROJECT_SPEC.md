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
- **M2.5** (done): the public patient-facing homepage — real doctor
  search with specialty/city filtering and result cards, reading from
  local Supabase. Doctor/secretary login demoted out of the primary
  patient nav (moved to a subtle footer link) to keep the staff workspace
  a separate, desktop-first flow, not mixed into patient browsing. Still
  no booking, no availability.
- **M3** (done): the availability engine — a TypeScript slot-generation
  path proven consistent with `compute_available_slots` (SQL), not yet
  wired into any booking UI. See "Availability engine (M3)" below.
- **M4** (done): the booking flow — the availability engine wired into
  the doctor profile page, a patient-facing slot picker and booking form,
  Server Actions calling `book_appointment` in trusted server code, a
  confirmation view. No patient cancellation/rescheduling UI, no doctor
  dashboard. See "Booking flow (M4)" below.
- **M5** (this milestone): patient self-service management — the
  `/manage` token-exchange page the M4 confirmation screen links to but
  didn't build, plus patient-initiated cancellation and rescheduling. No
  login. No doctor dashboard (that's M6). See "Patient self-service (M5)"
  below.
- **M6+**: not started. Don't infer scope for it from this file. In
  particular: the doctor/secretary dashboard and the actual email-sending
  mechanism (including how a sent email gets a token-bearing link — see
  "Booking flow (M4)" for why that's deferred, not decided) both belong
  here.

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
| `appointment_management_sessions` | short-lived session created when a token is redeemed; `session_secret_hash` (added M5) is the hash of an independent bearer secret — never the row's own `id`, see "Patient self-service (M5)" |
| `doctor_qualifications`, `doctor_publications`, `doctor_books`, `doctor_media_appearances` | public-profile content, one-to-many on `doctor_id` |
| `email_outbox` | queued transactional email; enqueued by privileged functions, sending itself is a later milestone |
| `audit_log` | write-only-by-function record of privileged actions |

## Functions

- `private.is_doctor_owner`, `private.is_staff_for_doctor` — RLS helpers.
- `public.compute_available_slots(doctor_id, clinic_id, appointment_type_id, local_date, now)` — derives bookable slots from exceptions → working hours → breaks → blocked periods → existing confirmed appointments → minimum booking notice. `now` is a parameter (not `now()`) so lead-time behavior is deterministic in tests.
- `private.is_within_working_window(doctor_id, clinic_id, starts_at, ends_at, now)` — the same exceptions/working-hours/breaks/blocked-periods resolution as `compute_available_slots`, **plus** the same minimum-booking-notice check, as a single boolean check for one candidate range. `now` was added in M4 after a real gap was found: this function originally checked only the schedule (working hours/breaks/blocked/exceptions), never past-ness or notice — only the *read* path (`compute_available_slots`) enforced notice, so a write could accept a past or too-soon `starts_at`. `book_appointment`/`reschedule_appointment` pass `now()` at their call sites; the parameter exists (rather than reading `now()` internally) so the function stays consistent with the rest of the schedule-resolution logic's testable-parameter style. Internal-only (revoked from every role, including `service_role`) — only ever called from within those two `SECURITY DEFINER` functions, which already run as the definer.
- `public.book_appointment`, `public.cancel_appointment`, `public.reschedule_appointment` — the only way to mutate `appointments`. Both `cancel_appointment` and `reschedule_appointment` require the appointment's current status to be `confirmed` (errcode `55000` otherwise) — repeat cancellation/reschedule of an already-cancelled/completed/no_show appointment is rejected, not silently re-applied. Each takes either `p_actor_user_id` (staff path) or `p_management_session_secret_hash` (patient path, renamed from `p_management_session_id` in M5 — see "Patient self-service (M5)"); `reschedule_appointment` also invalidates (`used_at = now()`) any outstanding management tokens for that appointment on a successful reschedule, and can atomically issue a replacement via an optional `p_new_management_token_hash`.
- `public.create_management_token`, `public.redeem_management_token` — token issuance/redemption, hash-only. `redeem_management_token` uses one generic error (`42501`, "invalid or expired token") for an unknown, expired, already-used, or reschedule-invalidated token — it never reveals which case applies. Since M5, also takes `p_session_secret_hash` and stores it on the created session (see "Patient self-service (M5)").

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

## Availability engine (M3)

Two implementations of the same algorithm exist on purpose, not by
accident:

- **SQL** (`public.compute_available_slots`, M1) is authoritative. It's
  what `book_appointment`/`reschedule_appointment` ultimately defer to
  (via `private.is_within_working_window`), backed by the GiST exclusion
  constraint as the final safety net — a bug in the TS side can produce a
  wrong *read*, never a wrong *write*.
- **TypeScript** (`src/lib/availability/`) is what actual application code
  should call to answer "what's available" — no per-request round trip
  through a SQL function, fully unit-testable, usable anywhere Node runs.

The two are proven consistent, not just similar, by
`tests/availability/sql-consistency.test.ts`: for a range of scenarios it
seeds real rows, calls the SQL RPC and the TS path with identical
parameters, and asserts the resulting slots match exactly. If you change
one implementation, change the other and re-run that suite — nothing else
enforces the two staying in sync.

TypeScript module layout:

- `compute-available-slots.ts` — the pure algorithm (no I/O). Mirrors the
  SQL function branch-for-branch: schedule exception → else recurring
  working hours → subtract breaks → subtract blocked periods → subtract
  existing `confirmed` appointments → apply minimum booking notice. Uses
  Luxon for IANA-timezone-aware wall-clock↔instant conversion (hand-rolled
  offset math was judged too easy to get subtly wrong).
- `fetch-availability-data.ts` — resolves doctor/clinic/appointment-type
  IDs into the plain data the pure function needs, and calls it. Takes a
  `SupabaseClient<Database>` as a parameter (dependency injection)
  instead of constructing its own — this is what makes it callable from
  Vitest with a locally-built client, without pulling in
  `service-role.ts`'s `import "server-only"` guard, which throws outside
  Next's own bundler.
- `get-available-slots.ts` — the real entry point future application code
  (a booking UI, not built yet) should call. Thin: constructs a
  service-role client and delegates to `fetch-availability-data.ts`. Has
  the `server-only` guard, appropriately, since `working_hours`/`breaks`/
  `blocked_periods`/`schedule_exceptions` have no anon/authenticated grant
  at all (same requirement the SQL function has).

## Booking flow (M4)

**Server Actions are the only place client code touches the availability
engine or `book_appointment`** — `doctors/[slug]/actions.ts`
(`getSlotsAction`, `submitBookingAction`). The booking widget
(`src/components/booking/`, client components) never calls Supabase
directly. Same DI-core pattern as the M3 availability engine:
`src/lib/booking/book-appointment.ts` takes a `SupabaseClient<Database>`
as a parameter so it's testable from Vitest without the
`service-only`/`server-only` guard fighting the test runner; the Server
Action constructs the real service-role client and calls it.

**Confirmation is a client-side view swap, not a distinct route.**
`submitBookingAction` returns the full result (appointment + raw
management token) directly over the RSC payload; the booking widget
renders a confirmation view in place of the form. Deliberate, not an
oversight: putting patient name/phone/email in a URL to reach a
`/confirmation` page would put PII in a URL, and `appointments` has no
anon SELECT policy anyway (staff-only) — a public confirmation route
couldn't re-fetch the booking even if we tried.

**Management link format**: `/{locale}/manage#token=<raw_token>`,
built client-side (`window.location.origin` isn't available
server-side). The fragment (`#...`) is deliberate — it's never sent to
the server in the HTTP request, so no server/proxy/access log ever sees
the raw token. M4 displays this link as text on the confirmation screen.
`/manage` itself — the token-exchange page, view/cancel/reschedule — is
M5; see "Patient self-service (M5)" below.

**Token expiry policy: `starts_at` + 24 hours.** This is the first place
an actual duration is set — every SQL function since M1
(`create_management_token`, `book_appointment`, `reschedule_appointment`)
took `expires_at` as a bare caller-supplied parameter with no documented
policy for what the caller should pass. Implemented in
`book-appointment.ts`; if this needs to change, this is the one place to
change it.

**Raw token handling — what M4 does, and what's explicitly deferred:**
the raw token is generated in `generate-management-token.ts`, exists only
in trusted server memory and the Server Action's return value to the
booking widget, and is never persisted — not in `appointments`, not in
`appointment_management_tokens` (only its SHA-256 hash), not in
`email_outbox.payload` (which only ever held `{appointment_id}`, from M1
onward — unchanged here), not in logs. `book_appointment` already
enqueues the `email_outbox` row exactly as it did before M4; M4 does not
send email.

What M4 deliberately does **not** decide: how a *future* email-sending
process gets a token-bearing link into that email, given the raw
booking-time token can't be recovered from its hash. One candidate is
minting a fresh token at send time via the existing
`create_management_token` RPC (nothing stops one appointment having
multiple simultaneously-valid tokens), but that has real retry/idempotency
implications — a naive retry-on-failure email sender could accumulate
unlimited valid tokens for one appointment. That design, together with
retry behavior, belongs to the email-delivery milestone and should be
worked out and tested there, not assumed here.

**`book_appointment`'s existing validation is the write-time authority**
for everything the booking widget's slot picker already tried to
guarantee client-side (a real, currently-offered slot) — the exclusion
constraint, `is_within_working_window` (now notice-aware, see
`is_within_working_window` above), and the composite FKs. The widget
treats two RPC error codes as recoverable conflicts, both handled the
same way (show a message, clear the selected slot, re-fetch availability
for the current date): `23P01` (exclusion_violation — another booking won
the race) and `55001` (schedule changed since the slots were fetched —
notice window passed, doctor closed that time, etc.).

## Patient self-service (M5)

**The database layer for this milestone was already built in M1/M4** —
`redeem_management_token`, `cancel_appointment`, `reschedule_appointment`
already supported a session-based patient path (alongside the staff
`p_actor_user_id` path) before any application code called it. M5 is
mostly a Next.js application-layer milestone on top of that, plus one
targeted schema/function fix (below) made before any code depended on the
flawed original design.

**Session credential: an independent secret, never the session row's own
id.** The original M1 design had `redeem_management_token` return the
`appointment_management_sessions` row, with the intent that its `id`
(a `gen_random_uuid()`) would be passed straight back into
`cancel_appointment`/`reschedule_appointment` as the patient's bearer
credential. That conflates a database identifier with a credential — if
that id were ever incidentally logged, surfaced in an error message, or
exposed via some future unrelated endpoint, it would double as a live
credential for the appointment it belongs to. Fixed in
`supabase/migrations/20260101000019_management_session_secret_hash.sql`,
before M5 shipped: `appointment_management_sessions` gained a
`session_secret_hash` column (`unique`, `not null`, same pattern as
`appointment_management_tokens.token_hash`); `redeem_management_token`
takes a second parameter, `p_session_secret_hash`, generated and hashed
in trusted Next.js server code (`src/lib/booking/crypto-secret.ts` —
`generateOpaqueSecret`/`hashSecret`, the same primitive
`generate-management-token.ts` uses for the raw token itself) and never
computed in or returned by Postgres; `cancel_appointment`/
`reschedule_appointment`'s session parameter was renamed from
`p_management_session_id uuid` to `p_management_session_secret_hash text`,
matched against that hash instead of the row id. `id` remains an internal
identifier only. This was a clean rename, not a parallel/legacy path — no
shipped consumer had ever called the session parameter on either function
before M5.

**Cookie**: `manage_session`, set by `redeemManagementTokenAction`
(`src/app/[locale]/(public)/manage/actions.ts`) holding the **raw**
session secret (`src/lib/booking/manage-session-cookie.ts`):
`httpOnly`, `sameSite: "strict"`, `secure` in production, `maxAge` from
the RPC's own `session.expires_at` (currently 30 minutes, set inside
`redeem_management_token`). **`path: "/"`, not locale-scoped** —
`localePrefix: "always"` (`src/i18n/routing.ts`) means `/fr/manage` and
`/ar/manage` share no shorter path, and scoping to one locale would
silently drop the session the moment a patient used the locale switcher
(the token that created it is already burned by then — unrecoverable).
This is the only application-level cookie in the codebase (the only other
cookie usage, `src/lib/supabase/server.ts`, is Supabase's own
auth-session cookie). Every request past redemption reads the raw secret
from the cookie and hashes it once (`hashSecret`) before it touches
Postgres or any DI-core function — see
`src/lib/booking/get-managed-appointment.ts`, the single point every
Server Action resolves a session through (also the freshness check: it
does a direct service-role read of `appointment_management_sessions`,
mirroring `fetch-availability-data.ts`'s existing precedent, rather than
a new SQL function).

**A raw token in the URL fragment always takes priority over an existing
cookie.** `src/components/manage/manage-gate.tsx` always mounts and always
checks `window.location.hash` for a token — regardless of whether the
server already resolved a valid appointment from the cookie. Without
this, a patient who already has an active session (e.g. they booked two
appointments and are opening the second confirmation link while the first
is still within its 30-minute window) would keep seeing the *first*
appointment, since only client code can see a URL fragment at all. Two
non-obvious details in that component, both covered by
`tests/e2e/manage.spec.ts`:
- The redemption attempt is guarded by a ref keyed on the *specific
  token string* (not a plain "ran once" boolean) — React Strict Mode
  double-invokes effects in development, and token redemption isn't
  idempotent (the second attempt on the same token fails, since it's
  already burned), so a plain boolean guard would work for that but then
  permanently block every *later*, different token too — e.g. a patient
  clicking a second appointment's link in an already-open tab, which
  changes the URL fragment without remounting the component. Hence a
  `hashchange` listener alongside the on-mount check, and a
  token-keyed ref rather than a boolean one.
- On a successful redemption, the UI doesn't flip to the appointment view
  until the **refreshed** `appointment` prop actually arrives from
  `router.refresh()` — not immediately, since `router.refresh()` doesn't
  resolve synchronously and this component doesn't unmount/remount around
  it the way separate components swapped by a parent would.

**Reschedule rotates the management token — no permanent lockout.**
`src/lib/booking/reschedule-managed-appointment.ts` generates a fresh raw
token the same way `book-appointment.ts` does, with expiry = new
`starts_at` + 24h (same policy as the original booking token), and passes
its hash into `reschedule_appointment`'s existing
`p_new_management_token_hash`/`p_new_management_token_expires_at`
parameters (built in M1/M4, never wired up before this). The RPC
unconditionally burns the *old* token on any reschedule regardless — the
patient must always get a working replacement link, which
`managed-appointment-view.tsx` displays on a dedicated post-reschedule
screen (`managementLinkTitle`/`...Description`, same idea as the M4
booking confirmation's link block). The browser's cookie-backed
**session** is untouched by a reschedule — it's a separate table
(`appointment_management_sessions`) `reschedule_appointment` never
writes to, so the patient stays logged into the same session across a
reschedule without needing the new link at all, right up until that
session's own 30-minute window lapses.

**Privacy headers**: `Cache-Control: no-store`, `Referrer-Policy:
no-referrer`, `X-Robots-Tag: noindex, nofollow` (plus a matching
`<meta name="robots">` via `generateMetadata`), declared in
`next.config.ts`'s `headers()` for `/:locale/manage/:path*`. Verified
against a production build (`next build && next start`) — Next's dev
server serves its own blanket `Cache-Control: no-cache, must-revalidate`
for *every* route in development regardless of this config (an
intentional Next.js dev-mode behavior, not a bug here — see "In
Development, Pages are always rendered on-demand and are never cached"
in the Next.js docs), so don't use `next dev` to sanity-check these
headers; `tests/e2e/manage.spec.ts` asserts them against the real
(production-build) Playwright server. No analytics/tag-manager script may
ever be added to this route or a shared layout it inherits from — the
management experience carries privacy-sensitive appointment data
reachable by anyone holding the link; verified via repo-wide grep that
none exist anywhere in `src/` as of M5.

**No new `appointment_id` index.** Every read/write path M5 introduces
resolves through a primary-key or unique-constraint predicate first
(`appointment_management_sessions.session_secret_hash`,
`appointments.id`) — never a plain `appointment_id` scan. The one
pre-existing query that does filter `appointment_management_tokens` by
`appointment_id` alone (`reschedule_appointment`'s token-invalidation
`update`) predates M5 and operates on a tiny per-appointment row count,
same deferred-until-scale reasoning as M2.5's in-memory search filtering.

**Deferred, not solved**: no re-entry once a session's 30-minute window
lapses after its token was already burned — the only way back in is a
fresh email, which is the not-yet-built email-delivery milestone's
concern, consistent with how M4 already deferred that mechanism. No
rate-limiting on token redemption, consistent with `book_appointment`
also having none.

## Local-only guardrail

Nothing in M1 touches a hosted Supabase project. Migrations apply only via
`supabase db reset` against the local Docker stack; tests read
`TEST_SUPABASE_*` env vars pointed at `127.0.0.1` from a gitignored
`.env.test.local`, never `.env.local`.
