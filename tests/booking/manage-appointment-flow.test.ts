import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture, type DoctorFixture } from "../db/fixtures";
import { bookAppointment } from "@/lib/booking/book-appointment";
import { redeemManagementToken } from "@/lib/booking/redeem-management-token";
import { getManagedAppointment } from "@/lib/booking/get-managed-appointment";
import { cancelManagedAppointment } from "@/lib/booking/cancel-managed-appointment";
import { rescheduleManagedAppointment } from "@/lib/booking/reschedule-managed-appointment";
import { ManageError } from "@/lib/booking/manage-errors";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the M5 DI-core layer (src/lib/booking/{redeem,get,cancel,reschedule}-managed-appointment.ts)
// the real /manage Server Actions call — see PROJECT_SPEC.md "Patient
// self-service (M5)".

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const LOCAL_DATE = "2030-07-01";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

const PATIENT = {
  patientName: "Manage Test Patient",
  patientPhone: "+216 71 000 010",
  patientEmail: "manage-patient@example.test",
};

describe("manage-appointment flow (M5)", () => {
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

  function bookForManagement(doctor: DoctorFixture, startsAt: string) {
    return bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt,
      ...PATIENT,
    });
  }

  it("redeemManagementToken returns a session secret distinct from the session row's id and from the raw token", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T09:00:00Z`);

    const { session, sessionSecret } = await redeemManagementToken(admin, booked.managementToken);

    expect(session.appointment_id).toBe(booked.appointment.id);
    expect(sessionSecret).not.toBe(session.id);
    expect(sessionSecret).not.toBe(booked.managementToken);
    expect(sessionSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redeemManagementToken rejects an unknown raw token", async () => {
    await expect(redeemManagementToken(admin, "0".repeat(64))).rejects.toMatchObject({
      code: "INVALID_OR_EXPIRED_TOKEN",
    });
  });

  it("redeemManagementToken rejects an expired token", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T09:30:00Z`);

    const tokenHash = sha256(booked.managementToken);
    await admin
      .from("appointment_management_tokens")
      .update({ expires_at: "2020-01-01T00:00:00Z" })
      .eq("token_hash", tokenHash);

    await expect(redeemManagementToken(admin, booked.managementToken)).rejects.toMatchObject({
      code: "INVALID_OR_EXPIRED_TOKEN",
    });
  });

  it("redeemManagementToken rejects a token that was already redeemed once", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T10:00:00Z`);

    await redeemManagementToken(admin, booked.managementToken);
    await expect(redeemManagementToken(admin, booked.managementToken)).rejects.toMatchObject({
      code: "INVALID_OR_EXPIRED_TOKEN",
    });
  });

  it("getManagedAppointment resolves the full flattened view for a live session", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T11:00:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);

    const view = await getManagedAppointment(admin, sha256(sessionSecret));

    expect(view).not.toBeNull();
    expect(view?.id).toBe(booked.appointment.id);
    expect(view?.status).toBe("confirmed");
    expect(view?.patientName).toBe(PATIENT.patientName);
    expect(view?.doctorId).toBe(doctor.doctorId);
    expect(view?.clinicId).toBe(doctor.clinicId);
    expect(view?.appointmentTypeId).toBe(doctor.appointmentTypeId);
    // Belt and suspenders — neither secret should be reachable through the
    // view, which only ever carries the resolved appointment's own fields.
    expect(JSON.stringify(view)).not.toContain(booked.managementToken);
    expect(JSON.stringify(view)).not.toContain(sessionSecret);
  });

  it("getManagedAppointment returns null for an unknown or expired session hash", async () => {
    expect(await getManagedAppointment(admin, "0".repeat(64))).toBeNull();

    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T11:30:00Z`);
    const { session, sessionSecret } = await redeemManagementToken(admin, booked.managementToken);
    await admin
      .from("appointment_management_sessions")
      .update({ expires_at: "2020-01-01T00:00:00Z" })
      .eq("id", session.id);

    expect(await getManagedAppointment(admin, sha256(sessionSecret))).toBeNull();
  });

  it("cancelManagedAppointment only affects the appointment its own session belongs to", async () => {
    const doctor = await setupDoctorWithHours();
    const bookedA = await bookForManagement(doctor, `${LOCAL_DATE}T12:00:00Z`);
    const bookedB = await bookForManagement(doctor, `${LOCAL_DATE}T13:00:00Z`);

    const { sessionSecret: secretA } = await redeemManagementToken(admin, bookedA.managementToken);
    const { sessionSecret: secretB } = await redeemManagementToken(admin, bookedB.managementToken);

    const result = await cancelManagedAppointment(admin, sha256(secretA));
    expect(result.id).toBe(bookedA.appointment.id);
    expect(result.status).toBe("cancelled");

    const viewB = await getManagedAppointment(admin, sha256(secretB));
    expect(viewB?.id).toBe(bookedB.appointment.id);
    expect(viewB?.status).toBe("confirmed");
  });

  it("cancelManagedAppointment rejects a second cancellation of the same appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T14:00:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);
    const secretHash = sha256(sessionSecret);

    await cancelManagedAppointment(admin, secretHash);
    await expect(cancelManagedAppointment(admin, secretHash)).rejects.toMatchObject({
      code: "NOT_MODIFIABLE",
    });
  });

  it("rescheduleManagedAppointment succeeds and returns a new raw token distinct from the old one, expiring at newStartsAt + 24h", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T09:00:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);
    const secretHash = sha256(sessionSecret);

    const newStartsAt = `${LOCAL_DATE}T10:00:00Z`;
    const result = await rescheduleManagedAppointment(admin, {
      managementSessionSecretHash: secretHash,
      newStartsAt,
    });

    expect(new Date(result.appointment.starts_at).getTime()).toBe(new Date(newStartsAt).getTime());
    expect(result.managementToken).not.toBe(booked.managementToken);
    expect(result.managementToken).toMatch(/^[0-9a-f]{64}$/);

    const { data: tokenRow } = await admin
      .from("appointment_management_tokens")
      .select("expires_at")
      .eq("token_hash", sha256(result.managementToken))
      .single();
    const expectedExpiry = new Date(newStartsAt).getTime() + 24 * 60 * 60 * 1000;
    expect(new Date(tokenRow!.expires_at).getTime()).toBe(expectedExpiry);

    // The new token itself must be redeemable into a working session for
    // the same appointment...
    const { session: newSession } = await redeemManagementToken(admin, result.managementToken);
    expect(newSession.appointment_id).toBe(booked.appointment.id);

    // ...while the old, pre-reschedule token is now burned.
    await expect(redeemManagementToken(admin, booked.managementToken)).rejects.toBeInstanceOf(
      ManageError,
    );
  });

  it("rescheduleManagedAppointment rejects a conflicting target time", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T11:00:00Z`);
    await bookForManagement(doctor, `${LOCAL_DATE}T12:00:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);

    await expect(
      rescheduleManagedAppointment(admin, {
        managementSessionSecretHash: sha256(sessionSecret),
        newStartsAt: `${LOCAL_DATE}T12:00:00Z`,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("rescheduleManagedAppointment rejects an out-of-hours target time", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T09:00:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);

    await expect(
      rescheduleManagedAppointment(admin, {
        managementSessionSecretHash: sha256(sessionSecret),
        newStartsAt: `${LOCAL_DATE}T20:00:00Z`,
      }),
    ).rejects.toMatchObject({ code: "SCHEDULE_CHANGED" });
  });

  it("rescheduleManagedAppointment rejects rescheduling an appointment that is no longer confirmed", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookForManagement(doctor, `${LOCAL_DATE}T14:30:00Z`);
    const { sessionSecret } = await redeemManagementToken(admin, booked.managementToken);
    const secretHash = sha256(sessionSecret);

    await cancelManagedAppointment(admin, secretHash);

    await expect(
      rescheduleManagedAppointment(admin, {
        managementSessionSecretHash: secretHash,
        newStartsAt: `${LOCAL_DATE}T15:00:00Z`,
      }),
    ).rejects.toMatchObject({ code: "NOT_MODIFIABLE" });
  });
});
