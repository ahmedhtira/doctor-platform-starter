/**
 * Classifies the Postgres error codes book_appointment can raise (see
 * supabase/migrations/20260101000018_booking_notice_enforcement.sql) into
 * a small set the UI can react to. Both SLOT_UNAVAILABLE and
 * SCHEDULE_CHANGED get the same UX treatment (show a message, clear the
 * selected slot, re-fetch availability) — they're kept distinct only so
 * the message text can differ ("someone just booked this" vs "this time
 * is no longer offered").
 */
export type BookingErrorCode =
  | "SLOT_UNAVAILABLE" // 23P01 exclusion_violation — another booking won the race
  | "SCHEDULE_CHANGED" // 55001 — outside working hours / too soon / blocked, as of right now
  | "INVALID_APPOINTMENT_TYPE" // 22023 — appointment type doesn't belong to this doctor
  | "UNKNOWN";

const CODE_BY_POSTGRES_ERRCODE: Record<string, BookingErrorCode> = {
  "23P01": "SLOT_UNAVAILABLE",
  "55001": "SCHEDULE_CHANGED",
  "22023": "INVALID_APPOINTMENT_TYPE",
};

export function classifyBookingError(postgresErrorCode: string | undefined): BookingErrorCode {
  if (!postgresErrorCode) {
    return "UNKNOWN";
  }
  return CODE_BY_POSTGRES_ERRCODE[postgresErrorCode] ?? "UNKNOWN";
}

export class BookingError extends Error {
  readonly code: BookingErrorCode;

  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
    this.code = code;
  }
}
