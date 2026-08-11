/**
 * Errors raised by admin doctor-management operations. Deliberately more
 * specific than the patient-facing ManageError/BookingError philosophy
 * of "one generic message" — that discipline exists to prevent account
 * enumeration by an untrusted party (a patient, an unauthenticated
 * visitor). The platform admin is the one fully-trusted actor in this
 * whole app, so a specific "this email is already registered" message
 * is a usability win here, not an enumeration leak.
 */
export type AdminErrorCode =
  | "EMAIL_ALREADY_REGISTERED"
  | "SLUG_TAKEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "EMAIL_SEND_FAILED"
  | "UNKNOWN";

export class AdminError extends Error {
  readonly code: AdminErrorCode;

  constructor(code: AdminErrorCode, message: string) {
    super(message);
    this.name = "AdminError";
    this.code = code;
  }
}
