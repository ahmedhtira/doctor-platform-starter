/**
 * Classifies the Postgres error codes the manage-session RPCs
 * (redeem_management_token, cancel_appointment, reschedule_appointment —
 * see supabase/migrations/20260101000019_management_session_secret_hash.sql)
 * can raise. Kept separate from booking-errors.ts's BookingErrorCode
 * because 42501 means something different at each call site here: on
 * redeem it means "this token is unknown/expired/used" (deliberately
 * indistinguishable, per PROJECT_SPEC.md); on cancel/reschedule it means
 * "this session is invalid, expired, or doesn't own this appointment."
 */
export type ManageErrorCode = "INVALID_OR_EXPIRED_TOKEN" | "UNKNOWN";

export function classifyRedeemError(postgresErrorCode: string | undefined): ManageErrorCode {
  if (postgresErrorCode === "42501") {
    return "INVALID_OR_EXPIRED_TOKEN";
  }
  return "UNKNOWN";
}

export type ManageActionErrorCode =
  | "SESSION_INVALID" // 42501 — expired/unknown session, or scoped to a different appointment
  | "APPOINTMENT_NOT_FOUND" // P0002
  | "NOT_MODIFIABLE" // 55000 — appointment is no longer 'confirmed' / staff details aren't editable
  | "SLOT_UNAVAILABLE" // 23P01 — reschedule/update target collides with another booking
  | "SCHEDULE_CHANGED" // 55001 — target outside hours / too soon / blocked
  | "NOT_YET_ENDED" // 55002 — record_appointment_outcome: appointment hasn't ended yet
  | "APPOINTMENT_STARTED" // 55003 — patient/self-service or manual-details cutoff after start
  | "UNKNOWN";

const CODE_BY_POSTGRES_ERRCODE: Record<string, ManageActionErrorCode> = {
  "42501": "SESSION_INVALID",
  P0002: "APPOINTMENT_NOT_FOUND",
  "55000": "NOT_MODIFIABLE",
  "23P01": "SLOT_UNAVAILABLE",
  "55001": "SCHEDULE_CHANGED",
  "55002": "NOT_YET_ENDED",
  "55003": "APPOINTMENT_STARTED",
};

export function classifyManageActionError(
  postgresErrorCode: string | undefined,
): ManageActionErrorCode {
  if (!postgresErrorCode) {
    return "UNKNOWN";
  }
  return CODE_BY_POSTGRES_ERRCODE[postgresErrorCode] ?? "UNKNOWN";
}

export class ManageError extends Error {
  readonly code: ManageErrorCode | ManageActionErrorCode;

  constructor(code: ManageErrorCode | ManageActionErrorCode, message: string) {
    super(message);
    this.name = "ManageError";
    this.code = code;
  }
}
