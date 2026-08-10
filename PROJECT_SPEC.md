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
- **M5** (done): patient self-service management — the `/manage`
  token-exchange page the M4 confirmation screen links to but didn't
  build, plus patient-initiated cancellation and rescheduling. No login.
  No doctor dashboard (that's M6). See "Patient self-service (M5)" below.
- **M6** (done): the doctor/secretary dashboard — login, a doctor-context
  switcher for secretaries staffing multiple doctors, Today/Calendar/
  Availability pages, staff-initiated cancel/reschedule. See "Doctor/
  secretary dashboard (M6)" below.
- **M7** (done): transactional email delivery — `email_outbox` actually
  gets processed, via Resend + React Email, in fr/ar, closing the specific
  hazard M4 flagged ("a naive retry-on-failure email sender could
  accumulate unlimited valid tokens for one appointment"). See
  "Transactional email delivery (M7)" below.
- **M8** (this milestone): appointment outcome recording — staff mark a
  past `confirmed` appointment `completed` or `no_show` via the new
  `public.record_appointment_outcome` function. A staff/secretary-
  management milestone was drafted and then explicitly cancelled as a
  product-scope decision (doctor and secretary share one login for the
  MVP) before any code was written; `doctor_secretaries` and
  `src/lib/dashboard/auth-context.ts`/`resolve-staffed-doctors.ts` are
  untouched by M8 and stay as M6 left them. See "Appointment outcomes
  (M8)" below.
- **M9** (this milestone): launch readiness and production deployment
  preparation — an audit-then-fix milestone, not a feature milestone. No
  hosted Supabase project touched, nothing deployed. See "Launch
  readiness (M9)" below and [`DEPLOYMENT.md`](DEPLOYMENT.md) for the
  actual runbooks/checklists.
- **M10+**: not started. Don't infer scope for it from this file.

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
| `appointment_management_tokens` | hashed single-use patient self-service token; `email_outbox_id` (M7, nullable, `unique`) links a token to the outbox row it was minted for — at most one live token per email event, see "Transactional email delivery (M7)" |
| `appointment_management_sessions` | short-lived session created when a token is redeemed; `session_secret_hash` (added M5) is the hash of an independent bearer secret — never the row's own `id`, see "Patient self-service (M5)" |
| `doctor_qualifications`, `doctor_publications`, `doctor_books`, `doctor_media_appearances` | public-profile content, one-to-many on `doctor_id` |
| `email_outbox` | queued transactional email; enqueued by privileged functions. `status` ∈ `pending, processing, sent, failed` (M7, was `pending, sent, failed`); `processing_started_at`/`claim_token` back the M7 claim lease, `attempts`/`last_error` track retries, `template_version` pins which `src/emails/v{n}/` component rendered/should render it, `first_send_attempt_at` backs the 23h provider-idempotency window — see "Transactional email delivery (M7)" |
| `audit_log` | write-only-by-function record of privileged actions |

## Functions

- `private.is_doctor_owner`, `private.is_staff_for_doctor` — RLS helpers.
- `public.compute_available_slots(doctor_id, clinic_id, appointment_type_id, local_date, now)` — derives bookable slots from exceptions → working hours → breaks → blocked periods → existing confirmed appointments → minimum booking notice. `now` is a parameter (not `now()`) so lead-time behavior is deterministic in tests.
- `private.is_within_working_window(doctor_id, clinic_id, starts_at, ends_at, now)` — the same exceptions/working-hours/breaks/blocked-periods resolution as `compute_available_slots`, **plus** the same minimum-booking-notice check, as a single boolean check for one candidate range. `now` was added in M4 after a real gap was found: this function originally checked only the schedule (working hours/breaks/blocked/exceptions), never past-ness or notice — only the *read* path (`compute_available_slots`) enforced notice, so a write could accept a past or too-soon `starts_at`. `book_appointment`/`reschedule_appointment` pass `now()` at their call sites; the parameter exists (rather than reading `now()` internally) so the function stays consistent with the rest of the schedule-resolution logic's testable-parameter style. Internal-only (revoked from every role, including `service_role`) — only ever called from within those two `SECURITY DEFINER` functions, which already run as the definer.
- `public.book_appointment`, `public.cancel_appointment`, `public.reschedule_appointment` — the only way to mutate `appointments`. Both `cancel_appointment` and `reschedule_appointment` require the appointment's current status to be `confirmed` (errcode `55000` otherwise) — repeat cancellation/reschedule of an already-cancelled/completed/no_show appointment is rejected, not silently re-applied. Each takes either `p_actor_user_id` (staff path) or `p_management_session_secret_hash` (patient path, renamed from `p_management_session_id` in M5 — see "Patient self-service (M5)"); `reschedule_appointment` also invalidates (`used_at = now()`) any outstanding management tokens for that appointment on a successful reschedule, and can atomically issue a replacement via an optional `p_new_management_token_hash`. Since M7, all three build a full display-data snapshot (doctor/clinic/appointment-type names, patient name, `starts_at`/`ends_at`) into the `email_outbox.payload` they enqueue, joining `doctors`/`clinics`/`appointment_types` at enqueue time — body-only changes, no signature changes. See "Transactional email delivery (M7)".
- `public.create_management_token`, `public.redeem_management_token` — token issuance/redemption, hash-only. `redeem_management_token` uses one generic error (`42501`, "invalid or expired token") for an unknown, expired, already-used, or reschedule-invalidated token — it never reveals which case applies. Since M5, also takes `p_session_secret_hash` and stores it on the created session (see "Patient self-service (M5)"). Since M7, also takes an optional `p_email_outbox_id`; when non-null, the insert becomes an upsert keyed on `appointment_management_tokens`'s `unique (email_outbox_id)` constraint rather than a plain insert — see "Transactional email delivery (M7)".
- `public.claim_email_outbox_batch(p_limit, p_max_attempts, p_claim_token, p_stale_after_minutes default 10)` — M7. Leases a batch of `email_outbox` rows (`pending`, or `processing` past `p_stale_after_minutes` — crashed-worker recovery) via `for update skip locked`, stamping `claim_token`/`processing_started_at` and incrementing `attempts`. See "Transactional email delivery (M7)".
- `public.record_appointment_outcome(p_appointment_id, p_actor_user_id, p_outcome)` — M8. Staff-only (no patient path — `p_actor_user_id` is required, not optional); transitions a `confirmed` appointment to `completed` or `no_show`. Locks the row (`select ... for update`) before any precondition check, not just before the write, so a concurrent conflicting request re-reads the post-commit row instead of racing the check-then-act sequence. Requires `ends_at <= now()`, errcode `55002` otherwise. See "Appointment outcomes (M8)".

All seven `public` functions above: `service_role` execute only.

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
`email_outbox.payload`, not in logs. `book_appointment` already
enqueues the `email_outbox` row exactly as it did before M4; M4 does not
send email. (M7 note: `email_outbox.payload` only held `{appointment_id}`
through M4/M5/M6 — M7 widened it into a full display-data snapshot, still
containing no raw token; see "Transactional email delivery (M7)".)

What M4 deliberately does **not** decide: how a *future* email-sending
process gets a token-bearing link into that email, given the raw
booking-time token can't be recovered from its hash. One candidate is
minting a fresh token at send time via the existing
`create_management_token` RPC (nothing stops one appointment having
multiple simultaneously-valid tokens), but that has real retry/idempotency
implications — a naive retry-on-failure email sender could accumulate
unlimited valid tokens for one appointment. That design, together with
retry behavior, belongs to the email-delivery milestone and should be
worked out and tested there, not assumed here. **Resolved in M7** — see
"Transactional email delivery (M7)" below: the token is a deterministic
derivation of the outbox row's own id, not a fresh mint, which sidesteps
the multiple-live-tokens problem entirely rather than managing around it.

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
fresh email. M7 built the email-sending mechanism itself, but nothing in
M7 adds a patient-facing "resend my management link" trigger — every M7
enqueue is still driven by book/cancel/reschedule, so this remains
deferred, just to a later milestone than M4 anticipated. No
rate-limiting on token redemption, consistent with `book_appointment`
also having none.

## Doctor/secretary dashboard (M6)

**Auth is Supabase's own `auth.users` sign-in**, not a custom scheme — a
doctor or secretary logs in via `signInWithPassword` and every dashboard
Server Action reads `auth.uid()` through the normal (RLS-bound) client,
then passes it as `p_actor_user_id` into the same M1 staff path
`cancel_appointment`/`reschedule_appointment` already had. No new
privileged-function surface was needed for staff actions — M6 is
almost entirely an application-layer milestone reusing M1's dual
staff/patient actor design.

**Doctor-context is preserved across the whole dashboard, not per-page.**
A secretary can staff more than one doctor (`doctor_secretaries` is
many-to-many); `src/lib/dashboard/auth-context.ts` resolves the full set
of doctors a signed-in user may act for, and the currently-selected one is
carried as a URL search param (`?doctorId=`) rather than component state —
so switching doctors doesn't reset which dashboard page is open, and a
bookmarked/shared dashboard link keeps working. `dashboard-links.ts`
centralizes building every internal dashboard URL with that param
attached, rather than each page hand-rolling it.

**Staff-initiated reschedule rotates the management token — same
no-lockout guarantee M5 built for the patient path.**
`src/lib/dashboard/reschedule-staff-appointment.ts` mints a fresh token
via `reschedule_appointment`'s existing `p_new_management_token_hash`
parameter exactly like `reschedule-managed-appointment.ts` does; a staff
member moving an appointment must never silently leave the patient
without a working link, even though the staff member isn't the one who'll
use it.

**Today/Calendar/Availability pages** (`(dashboard)/dashboard`,
`.../calendar`, `.../availability`) all read through
`fetch-dashboard-appointments.ts` (a DI-core, same pattern as every other
data-access module in this codebase) scoped to the selected doctor via
RLS's `is_staff_for_doctor`, not a function — plain authenticated reads,
no privileged function needed since RLS already governs staff visibility
correctly for this case. Availability CRUD (working hours/breaks/blocked
periods) is likewise plain RLS-governed reads/writes, not new functions.

**E2E fixtures use the existing service-role test infrastructure**
(`tests/e2e/dashboard-fixtures.ts`), not the dev seed script — consistent
with how `tests/e2e/manage.spec.ts` already seeded its own M5 fixtures,
so Playwright runs stay independent of whatever `scripts/seed-doctor.ts`
currently seeds for manual dev use.

## Transactional email delivery (M7)

M4 built `email_outbox` and named the two open questions it deliberately
left unanswered: how a sent email gets a token-bearing link (see "Booking
flow (M4)"), and the retry/idempotency hazard that follows from it — "a
naive retry-on-failure email sender could accumulate unlimited valid
tokens for one appointment." M7 answers both, sends real mail via Resend +
React Email in fr/ar, and extends enqueueing from booking-only to
cancellation and both reschedule paths.

**Claiming: `pending → processing → sent | failed`, a real recoverable
lease, not a status flag set-and-hope.**
`public.claim_email_outbox_batch(p_limit, p_max_attempts, p_claim_token,
p_stale_after_minutes default 10)` atomically moves a batch of rows to
`processing` (`for update skip locked`, so concurrent callers get disjoint
row sets) and stamps each with `claim_token`/`processing_started_at`,
incrementing `attempts`. It also reclaims rows still `processing` past
`p_stale_after_minutes` — recovery for a worker that crashed mid-send.
Every finalizing write (`process-email-outbox.ts`'s `finalizeSent`/
`finalizeRetryableFailure`/`finalizeTerminalFailure`) is conditioned on
`eq("claim_token", row.claim_token)`, not just `id` — a worker whose lease
was reclaimed out from under it affects 0 rows on its own finalize, rather
than asserting a status that's no longer its to set.

**The core idempotency mechanism: a deterministic, re-derivable
management token — not a fresh mint per attempt.** The token that goes
into a delivery email is `HMAC-SHA256(EMAIL_TOKEN_DERIVATION_KEY,
"doctor-platform/email-management-token/v1/" + email_outbox_id)`
(`src/lib/email/derive-management-token.ts`), hex-encoded to the same
64-character shape `managementTokenPattern` already validates — `/manage`,
`redeem_management_token`, `manage-gate.tsx` needed zero changes. Given
the same `email_outbox.id`, every attempt — same process, or a fresh one
after a crash — derives the byte-identical raw token, without that raw
value ever being stored anywhere. This is deliberately a separate
function from `generate-management-token.ts` (random, single-use, backs
the on-screen M4/M5/M6 tokens) rather than a shared one with a mode flag —
the two have genuinely different reuse semantics.

`appointment_management_tokens.email_outbox_id` (nullable, `unique`) lets
`create_management_token` become a real upsert for the email path
(`on conflict (email_outbox_id) do update ... returning`) rather than
insert-and-hope: functionally a no-op after the first successful call
(since the derived hash is always identical), and — critically — it never
touches `used_at`, so a token already redeemed by the patient before a
retry runs stays redeemed; reprocessing can't resurrect it. On-screen
tokens (`email_outbox_id: null`) are untouched by this path; Postgres
allows unlimited `NULL`s under a `unique` constraint.

Because the token is deterministic, the email body is byte-identical on
every attempt, which makes **one stable Resend idempotency key per outbox
event** (`doctor-platform-email/<email_outbox_id>`, no attempt suffix)
safe: Resend's documented same-key-same-body behavior (return the
original response, no new send) applies on every retry, not just the
first. `book_appointment`/`cancel_appointment`/`reschedule_appointment`
reinforce this on the data side too — all three now snapshot
doctor/clinic/appointment-type/patient display data into
`email_outbox.payload` at enqueue time (joining `doctors`/`clinics`/
`appointment_types`), so the worker renders straight from
Zod-validated `row.payload` and never re-queries live appointment state,
which could otherwise have changed between enqueue and a later retry.

**Two failure modes that stable-idempotency alone doesn't cover, closed
separately:**
- **Template drift.** If this app's own template/copy changes while a row
  is still `pending`, a retry could render different content against the
  same stable idempotency key. `email_outbox.template_version` (defaults
  to `1`) plus versioned template directories (`src/emails/v1/`, frozen
  once shipped — a real change is a `src/emails/v2/` directory, never an
  edit to `v1`) make "don't change what a shipped version renders" a
  structural fact, not a policy someone has to remember.
  `render-outbox-email.ts` dispatches on `(template, template_version)`
  and throws a clear error for an unrecognized combination.
- **Resend's idempotency memory is 24h, not indefinite.**
  `email_outbox.first_send_attempt_at` is set exactly once, immediately
  before the first real `sender()` call for a row, via an
  `and first_send_attempt_at is null` guard — a no-op on every later
  attempt. Before deriving/rendering/sending, the worker checks
  `now() >= first_send_attempt_at + 23h`; past that, it refuses to call
  Resend at all and finalizes the row `failed` with
  `last_error = "provider idempotency retry window expired"` — the 1-hour
  margin is deliberate slack against the 24h boundary, not a rounding
  choice.

**A link-bearing email is also refused if it would already be dead on
arrival**: before deriving a token, the worker checks
`payload.starts_at + 24h <= now()` (the same token-lifetime policy M4
established) and finalizes `failed` with an explicit `last_error` if so —
a badly backlogged worker should never hand out a link that fails the
instant it's clicked. `appointment_cancellation` carries no link and is
unaffected by this guard.

**`EMAIL_TOKEN_DERIVATION_KEY` stability is load-bearing and has no
rotation mechanism in M7.** It must stay the same for as long as any
outbox row that could still be retried exists — rotating it changes the
derived token for every not-yet-sent row, silently invalidating links that
may already be in a patient's or staff member's hands. Generate via
`openssl rand -hex 32`; documented in `.env.example`. A future milestone
could version the derivation key the same way `template_version` versions
templates (a `derivation_key_version` column) if rotation is ever needed —
M7 doesn't build that, only leaves the door open.

**Worker is a standalone script, not a Route Handler**: `npm run
email:process` (`scripts/process-email-outbox.ts`, mirrors
`scripts/seed-doctor.ts`'s own env-loading/service-role-client pattern)
constructs the real `ResendEmailSender` and calls
`process-email-outbox.ts`'s `processEmailOutbox(supabase, sender,
options)` DI-core. `resend-sender.ts` deliberately has **no**
`import "server-only"` — only this plain-`tsx` script imports it, the
exact context that guard throws in.

## Appointment outcomes (M8)

`appointments.status` has allowed `completed`/`no_show` since the original
M1 check constraint, but nothing ever wrote either value — every
appointment that passed its `ends_at` just stayed `confirmed` forever, with
no way for a clinic to record whether a visit actually happened. M8 closes
that one gap, nothing else. (A staff/secretary-management milestone was
drafted as the original M8 candidate; it was cancelled as a product-scope
decision — doctor and secretary share one login for the MVP — before any
code was written. `doctor_secretaries` and the M6 auth-context/staffed-
doctors resolution are untouched.)

**One function, not two.** `completed` and `no_show` share every
precondition (actor must be staff for the appointment's doctor, current
status must be `confirmed`, the appointment must have already ended) and
differ only in the status string written. `cancel_appointment`/
`reschedule_appointment` are separate functions because they genuinely
differ in *what* they write; splitting completion from no-show would just
duplicate the whole precondition chain for a one-string difference.
`public.record_appointment_outcome` takes a **required** `p_actor_user_id`
— unlike `cancel_appointment`'s optional actor-or-session pair, there is no
patient path here at all.

**The row is locked (`select ... for update`) before any precondition
check runs, not just before the write.** Without this, two concurrent
requests against the same appointment (e.g. a stray double-click, or a
cancel racing an outcome recording) could both read `status = 'confirmed'`
before either commits, both pass their checks, and both "succeed" — the
second silently overwriting the first with no error, since the plain
`update ... where id = ...` has no status condition to make it safe on its
own. With the lock, Postgres serializes the two calls at the `for update`
step: whichever commits first wins, and the second re-reads the now-
updated row and correctly rejects with `55000` instead of blindly
overwriting. Covered by
`tests/dashboard/record-staff-appointment-outcome.test.ts`'s concurrent
test, which fires two conflicting `record_appointment_outcome` calls at
the same appointment and asserts exactly one succeeds.

**Time gating is enforced in SQL, not just the UI.** `ends_at > now()` →
errcode `55002`, continuing the class-55 ("object not in prerequisite
state") numbering `55000`/`55001` already use. Same write-layer-is-the-
authority stance as `is_within_working_window` and the `confirmed`-status
check — a client's clock is not authoritative, so the dashboard's button-
visibility check (`appointment-actions.tsx`, gated on
`status === "confirmed" && endsAt <= now()`) is a convenience, not the real
guard.

**No `email_outbox` enqueue.** Recording an outcome is an internal clinic
record — nothing about what the patient was told (their appointment time,
whether it's still happening) changes, so unlike book/cancel/reschedule
this function never touches `email_outbox`.

## Launch readiness (M9)

An audit-then-fix milestone, not a feature milestone — the goal was
making the existing M0–M8 MVP safe and ready for a small real-world
pilot, not adding product surface. Three parallel audits (environment
variables/secrets/service-role usage, security headers/cookies/robots/RLS
grants, deployment/ops/logging) found the application's own security
model already matched this document exactly — no RLS drift, no
over-broad grant, no secret ever reachable from client code or committed
to git history. The gaps were all *around* the application, not in it;
this section records the decisions made to close them.
[`DEPLOYMENT.md`](DEPLOYMENT.md) has the actual step-by-step checklists
this section doesn't repeat.

**Security headers: two, not a full CSP.** `next.config.ts` gained a
platform-wide `X-Content-Type-Options: nosniff`/`X-Frame-Options: DENY`
block, additive alongside the M5 `/manage`-specific block (unchanged). A
full Content-Security-Policy was considered and deliberately deferred —
getting one right for this app's actual inline-script/style needs is a
meaningfully riskier change than a small pilot's launch needs, not a
change to make hastily inside an audit milestone.
`Strict-Transport-Security` isn't set here either; Vercel applies it
automatically for custom domains on its platform, verified by
`DEPLOYMENT.md`'s smoke test rather than asserted redundantly in
application code.

**`src/app/robots.ts` (new).** Disallows `/*/login`, `/*/dashboard`,
`/*/manage` for every crawler; the public patient-facing site (doctor
search/profiles) stays allowed — it's a marketplace, being findable is
the point. No sitemap; none existed before M9 and none was added.

**The email worker finally has a production trigger.** M7 built
`processEmailOutbox` (`src/lib/email/process-email-outbox.ts`) and a
manual script to run it (`npm run email:process`), but nothing was ever
wired to actually call that script once deployed — every confirmation/
cancellation/reschedule email would have silently never sent in
production. New: `src/app/api/cron/process-email-outbox/route.ts`, a
thin Route Handler that checks a `CRON_SECRET` against the
`Authorization: Bearer <secret>` header Vercel automatically sends to
cron invocations (verified live against Vercel's own docs while
designing this), then calls the identical, unmodified
`processEmailOutbox()` DI-core the manual script already used — no
duplicated logic. `vercel.json` schedules it every 5 minutes.

**That 5-minute schedule requires Vercel Pro or higher — this is
deliberate, not an oversight.** Vercel Hobby restricts cron jobs to once
per day and will reject a more-frequent `vercel.json` at deploy time.
Once-daily batching was considered and rejected: a patient booking an
appointment expects a confirmation email within minutes, and silently
downgrading the committed schedule to satisfy a free tier would quietly
break the exact product experience M7 was built for. `DEPLOYMENT.md`
states the two real options explicitly (upgrade to Pro, or point a
different scheduler at the same endpoint) rather than picking one
silently.

**Cron concurrency needed no new locking — M7's claim/lease design
already covers it.** Vercel documents cron delivery as "best effort" and
warns invocations can occasionally overlap or duplicate, recommending
idempotent, lock-protected handlers. No Redis or distributed lock was
added for M9: `claim_email_outbox_batch`'s `for update skip locked`
already gives concurrent callers disjoint row sets, `claim_token`
ownership already prevents a reclaimed lease from being double-finalized,
stale-lease recovery already handles a killed mid-batch invocation, and
Resend's own stable per-row idempotency key already absorbs a genuine
duplicate send attempt as a no-op. M9 is the first time something
(Vercel Cron) can actually invoke the worker concurrently with itself in
production; M7's design was already built to be safe under exactly that,
not just local sequential testing. See "Transactional email delivery
(M7)" above for the full mechanism.

**Basic logging, not a monitoring SaaS.** Every Server Action previously
caught errors and returned a client-facing message without logging
anywhere — a genuine production failure would have been invisible.
`console.error` was added at each *unexpected*-error path only (the
generic `catch` fallback after any classified `ManageError`/
`BookingError` branch, and `availability/actions.ts`'s previously-silent
Supabase-error early-returns) — deliberately not at classified
business-rule rejections like "slot no longer available," which are
expected outcomes, not bugs, and would just be noise. Vercel captures
`console.*` as function logs automatically; no new dependency. A real
error-monitoring SaaS was considered and deferred as unnecessary at pilot
scale — a call to make again once usage grows past comfortable log
tailing, not resolved here.

## Local-only guardrail

Nothing in M1–M8 touches a hosted Supabase project. Local migrations
apply only via `supabase db reset` against the local Docker stack; tests
read `TEST_SUPABASE_*` env vars pointed at `127.0.0.1` from a gitignored
`.env.test.local`, never `.env.local`. M9 adds a deployment *runbook*
(`DEPLOYMENT.md`) for a future hosted project — writing that runbook did
not itself touch or create one; this guardrail held throughout M9 too.
