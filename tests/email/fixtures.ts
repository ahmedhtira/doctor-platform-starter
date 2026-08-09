import { DateTime } from "luxon";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { createDoctorFixture, type DoctorFixture } from "../db/fixtures";
import { generateManagementToken } from "@/lib/booking/generate-management-token";
import { BookingError, classifyBookingError } from "@/lib/booking/booking-errors";
import type { BookAppointmentResult } from "@/lib/booking/book-appointment";
import type { Database } from "@/lib/supabase/database.types";
import type { EmailSender, SendEmailInput, SendEmailResult } from "@/lib/email/send-email";

// Shared across tests/email/*.test.ts — unlike tests/dashboard/ and
// tests/booking/ (independent files, each tolerating a little
// duplication on purpose), every file here needs the exact same "doctor
// with working hours, book an appointment" setup, so centralizing it is
// a real reduction in repetition rather than a premature abstraction.

export function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const LOCAL_DATE = "2031-08-04";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

export const PATIENT = {
  patientName: "Email Test Patient",
  patientPhone: "+216 71 000 040",
  patientEmail: "email-test-patient@example.test",
};

export async function setupDoctorWithHours(admin: SupabaseClient<Database>): Promise<DoctorFixture> {
  const doctor = await createDoctorFixture(admin);
  const { error } = await admin.from("working_hours").insert({
    doctor_id: doctor.doctorId,
    clinic_id: doctor.clinicId,
    day_of_week: DAY_OF_WEEK,
    start_time: "09:00",
    end_time: "17:00",
  });
  if (error) throw new Error(`failed to insert working_hours: ${error.message}`);
  return doctor;
}

/**
 * Mirrors src/lib/booking/book-appointment.ts's own RPC call exactly,
 * rather than calling that DI-core function directly — its BookingInput
 * type requires a non-null patientEmail (the public booking form always
 * collects one), but tests/email/enqueue.test.ts needs to book *without*
 * an email too, to prove the "no patient_email -> no outbox row" guard on
 * all four enqueue paths. The underlying RPC itself allows a null email.
 */
export async function bookForEmailTest(
  admin: SupabaseClient<Database>,
  doctor: DoctorFixture,
  startsAt: string,
  patientEmail: string | null = PATIENT.patientEmail,
): Promise<BookAppointmentResult> {
  const { rawToken, tokenHash } = generateManagementToken();
  // Non-null: startsAt is always a well-formed ISO instant in these tests.
  const tokenExpiresAt = DateTime.fromISO(startsAt).plus({ hours: 24 }).toUTC().toISO()!;

  const { data, error } = await admin.rpc("book_appointment", {
    p_doctor_id: doctor.doctorId,
    p_clinic_id: doctor.clinicId,
    p_appointment_type_id: doctor.appointmentTypeId,
    p_starts_at: startsAt,
    p_patient_name: PATIENT.patientName,
    p_patient_phone: PATIENT.patientPhone,
    // The generated Args type says `string` (Supabase's generator reads
    // "no SQL default" as "required non-null"), but book_appointment's own
    // body explicitly branches on `p_patient_email is not null` — the SQL
    // parameter has no NOT NULL constraint, only the generated TS type is
    // over-strict here. This cast reflects the real, intentional runtime
    // contract this test needs to exercise.
    p_patient_email: patientEmail as string,
    p_management_token_hash: tokenHash,
    p_management_token_expires_at: tokenExpiresAt,
  });

  if (error) {
    throw new BookingError(classifyBookingError(error.code), error.message);
  }

  return { appointment: data, managementToken: rawToken };
}

/**
 * Fetches every email_outbox row enqueued for a given appointment, oldest
 * first — an appointment can accumulate more than one over its lifetime
 * (e.g. confirmation, then a reschedule notification), so callers that
 * expect exactly one (the common case: a single book/cancel/reschedule
 * call in that test) should assert `.length === 1` themselves rather than
 * this helper assuming it for them.
 */
export async function getOutboxRowsForAppointment(admin: SupabaseClient<Database>, appointmentId: string) {
  const { data, error } = await admin
    .from("email_outbox")
    .select("*")
    .eq("payload->>appointment_id", appointmentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch email_outbox rows: ${error.message}`);
  return data;
}

export type FakeSenderCall = SendEmailInput;

export type FakeEmailSender = {
  sender: EmailSender;
  calls: FakeSenderCall[];
  /** Idempotency keys that resulted in an actual "distinct" provider
   * send — as opposed to a call that reused an already-seen key, which
   * (when `modelIdempotency` is on) Resend would recognize and return the
   * original cached result for, without processing a new send. */
  distinctSendKeys: Set<string>;
};

/**
 * In-memory EmailSender for tests/email/*.test.ts. With
 * `modelIdempotency: true`, mirrors Resend's own documented behavior
 * (resend.com/docs/dashboard/emails/idempotency-keys, verified while
 * designing M7): a second call with an already-seen idempotencyKey
 * returns the original result instead of performing a new logical send —
 * this is what lets process-email-outbox.test.ts prove a crash-and-retry
 * doesn't cause a second logical provider send, not just that the sender
 * function was invoked twice (it may be — that's expected and fine).
 */
export function createFakeEmailSender(options?: {
  failFirstNCalls?: number;
  modelIdempotency?: boolean;
}): FakeEmailSender {
  const calls: FakeSenderCall[] = [];
  const distinctSendKeys = new Set<string>();
  let callCount = 0;

  const sender: EmailSender = async (input): Promise<SendEmailResult> => {
    calls.push(input);
    callCount += 1;

    if (options?.failFirstNCalls && callCount <= options.failFirstNCalls) {
      return { success: false, error: "simulated transient failure" };
    }

    if (options?.modelIdempotency && distinctSendKeys.has(input.idempotencyKey)) {
      return { success: true, id: `cached-${input.idempotencyKey}` };
    }

    distinctSendKeys.add(input.idempotencyKey);
    return { success: true, id: `sent-${callCount}` };
  };

  return { sender, calls, distinctSendKeys };
}
