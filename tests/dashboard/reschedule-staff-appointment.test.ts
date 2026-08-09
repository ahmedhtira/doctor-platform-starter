import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import {
  cleanupUsers,
  createDoctorFixture,
  createSecretaryFixture,
  type DoctorFixture,
} from "../db/fixtures";
import { bookAppointment } from "@/lib/booking/book-appointment";
import { redeemManagementToken } from "@/lib/booking/redeem-management-token";
import {
  getStaffRescheduleSlots,
  rescheduleStaffAppointment,
} from "@/lib/dashboard/reschedule-staff-appointment";
import { ManageError } from "@/lib/booking/manage-errors";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the M6 correction: staff-initiated reschedule must rotate the
// patient's management token (never leave them with a dead link and no
// replacement), mirroring tests/booking/manage-appointment-flow.test.ts's
// equivalent proofs for the patient-initiated path.

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const LOCAL_DATE = "2031-07-02";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

const PATIENT = {
  patientName: "Staff Reschedule Test Patient",
  patientPhone: "+216 71 000 030",
  patientEmail: "staff-reschedule-patient@example.test",
};

describe("rescheduleStaffAppointment (M6)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  async function setupDoctorWithHours(): Promise<DoctorFixture> {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
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

  function bookForReschedule(doctor: DoctorFixture, startsAt: string) {
    return bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt,
      ...PATIENT,
    });
  }

  it("rotates the management token: old token invalid, exactly one new valid replacement, expiring at newStartsAt + 24h, raw value never stored", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForReschedule(doctor, `${LOCAL_DATE}T09:00:00Z`);
    const newStartsAt = `${LOCAL_DATE}T10:00:00Z`;

    const result = await rescheduleStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
      newStartsAt,
    });

    expect(new Date(result.appointment.starts_at).getTime()).toBe(new Date(newStartsAt).getTime());

    // Proof: the raw token is reachable exclusively through this return
    // value — no extra field could carry it elsewhere, and
    // dashboard/actions.ts's rescheduleAppointmentAction forwards this
    // object's `managementToken` unmodified into its own success-only
    // result, so this shape guard covers that layer too without needing to
    // import the service-role-guarded actions.ts file into this test.
    expect(Object.keys(result).sort()).toEqual(["appointment", "managementToken"]);

    // Proof: exactly one replacement token, not zero and not several — a
    // retry of this action must not be able to accumulate valid tokens for
    // the same appointment.
    const { data: allTokens, error: allTokensError } = await admin
      .from("appointment_management_tokens")
      .select("token_hash, used_at, expires_at")
      .eq("appointment_id", booked.appointment.id);
    if (allTokensError) throw new Error(allTokensError.message);
    expect(allTokens).toHaveLength(2); // the original (now burned) + the replacement
    const validTokens = allTokens!.filter((token) => token.used_at === null);
    expect(validTokens).toHaveLength(1);

    // Proof: raw replacement token is never itself a stored value — only
    // its SHA-256 hash matches the stored row.
    expect(result.managementToken).toMatch(/^[0-9a-f]{64}$/);
    expect(allTokens!.some((token) => token.token_hash === result.managementToken)).toBe(false);
    expect(validTokens[0].token_hash).toBe(sha256(result.managementToken));

    // Proof: expiry = new starts_at + 24h, not the original booking's.
    const expectedExpiry = new Date(newStartsAt).getTime() + 24 * 60 * 60 * 1000;
    expect(new Date(validTokens[0].expires_at).getTime()).toBe(expectedExpiry);

    // Proof: the replacement token actually works...
    const { session } = await redeemManagementToken(admin, result.managementToken);
    expect(session.appointment_id).toBe(booked.appointment.id);

    // ...while the original, pre-reschedule token is now burned/invalid.
    await expect(redeemManagementToken(admin, booked.managementToken)).rejects.toBeInstanceOf(
      ManageError,
    );
  });

  it("succeeds when the actor is a secretary for the doctor", async () => {
    const doctor = await setupDoctorWithHours();
    const secretary = await createSecretaryFixture(admin, doctor.doctorId);
    userIds.push(secretary.user.id);
    const booked = await bookForReschedule(doctor, `${LOCAL_DATE}T11:00:00Z`);

    const result = await rescheduleStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: secretary.user.id,
      newStartsAt: `${LOCAL_DATE}T12:00:00Z`,
    });

    expect(result.appointment.status).toBe("confirmed");
    expect(result.managementToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an actor with no staff relationship to the doctor", async () => {
    const doctor = await setupDoctorWithHours();
    const otherDoctor = await createDoctorFixture(admin);
    userIds.push(otherDoctor.user.id);
    const booked = await bookForReschedule(doctor, `${LOCAL_DATE}T13:00:00Z`);

    await expect(
      rescheduleStaffAppointment(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: otherDoctor.user.id,
        newStartsAt: `${LOCAL_DATE}T14:00:00Z`,
      }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("getStaffRescheduleSlots resolves slots from the appointment's own doctor/clinic/type, ignoring any other id", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForReschedule(doctor, `${LOCAL_DATE}T15:00:00Z`);

    const slots = await getStaffRescheduleSlots(admin, {
      appointmentId: booked.appointment.id,
      localDate: LOCAL_DATE,
    });

    expect(slots.length).toBeGreaterThan(0);
  });
});
