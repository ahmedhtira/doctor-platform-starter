import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture, type DoctorFixture } from "../db/fixtures";
import { bookAppointment } from "@/lib/booking/book-appointment";
import { fetchAvailableSlots } from "@/lib/availability/fetch-availability-data";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the same DI-core booking path (src/lib/booking/book-appointment.ts)
// the real Server Action calls — see PROJECT_SPEC.md "Booking flow (M4)".

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const LOCAL_DATE = "2030-03-04";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

const PATIENT = {
  patientName: "Amira Test Patient",
  patientPhone: "+216 71 000 000",
  patientEmail: "patient@example.test",
};

describe("book_appointment flow (M4)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  async function setupDoctorWithHours(
    opts: Parameters<typeof createDoctorFixture>[1] = {},
  ): Promise<DoctorFixture> {
    const doctor = await createDoctorFixture(admin, opts);
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

  it("books an appointment successfully end-to-end", async () => {
    const doctor = await setupDoctorWithHours();
    const startsAt = `${LOCAL_DATE}T09:00:00Z`;

    const result = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt,
      ...PATIENT,
    });

    expect(result.appointment.status).toBe("confirmed");
    expect(new Date(result.appointment.starts_at).getTime()).toBe(new Date(startsAt).getTime());
    expect(result.managementToken).toMatch(/^[0-9a-f]{64}$/);

    // Token expiry policy: starts_at + 24h (PROJECT_SPEC.md).
    const { data: tokenRow, error } = await admin
      .from("appointment_management_tokens")
      .select("expires_at")
      .eq("appointment_id", result.appointment.id)
      .single();
    if (error || !tokenRow) throw new Error(`failed to fetch token row: ${error?.message}`);

    const expectedExpiry = new Date(startsAt).getTime() + 24 * 60 * 60 * 1000;
    expect(new Date(tokenRow.expires_at).getTime()).toBe(expectedExpiry);
  });

  it("rejects a past starts_at even when it matches the recurring weekly window", async () => {
    const pastDate = "2020-01-06";
    const pastDayOfWeek = new Date(`${pastDate}T00:00:00Z`).getUTCDay();

    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: pastDayOfWeek,
      start_time: "09:00",
      end_time: "17:00",
    });

    await expect(
      bookAppointment(admin, {
        doctorId: doctor.doctorId,
        clinicId: doctor.clinicId,
        appointmentTypeId: doctor.appointmentTypeId,
        startsAt: `${pastDate}T09:00:00Z`,
        ...PATIENT,
      }),
    ).rejects.toMatchObject({ code: "SCHEDULE_CHANGED" });
  });

  it("rejects a slot inside a blocked period", async () => {
    const doctor = await setupDoctorWithHours();
    await admin.from("blocked_periods").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      starts_at: `${LOCAL_DATE}T09:00:00Z`,
      ends_at: `${LOCAL_DATE}T09:30:00Z`,
      reason: "test",
    });

    await expect(
      bookAppointment(admin, {
        doctorId: doctor.doctorId,
        clinicId: doctor.clinicId,
        appointmentTypeId: doctor.appointmentTypeId,
        startsAt: `${LOCAL_DATE}T09:00:00Z`,
        ...PATIENT,
      }),
    ).rejects.toMatchObject({ code: "SCHEDULE_CHANGED" });
  });

  it("rejects a slot outside working hours", async () => {
    const doctor = await setupDoctorWithHours(); // 09:00-17:00 Tunis
    await expect(
      bookAppointment(admin, {
        doctorId: doctor.doctorId,
        clinicId: doctor.clinicId,
        appointmentTypeId: doctor.appointmentTypeId,
        startsAt: `${LOCAL_DATE}T20:00:00Z`, // 21:00 Tunis, after close
        ...PATIENT,
      }),
    ).rejects.toMatchObject({ code: "SCHEDULE_CHANGED" });
  });

  it("rejects an appointment type whose duration pushes past the working window", async () => {
    const doctor = await setupDoctorWithHours(); // 09:00-17:00 Tunis = 08:00-16:00 UTC
    const { data: longType, error } = await admin
      .from("appointment_types")
      .insert({ doctor_id: doctor.doctorId, name: "Long consult", duration_minutes: 90 })
      .select()
      .single();
    if (error || !longType) throw new Error(`failed to create appointment type: ${error?.message}`);

    // 15:30 UTC + 90 min = 17:00 UTC, past the 16:00 UTC close — this slot
    // would be valid for the doctor's default 30-min type but not this one.
    await expect(
      bookAppointment(admin, {
        doctorId: doctor.doctorId,
        clinicId: doctor.clinicId,
        appointmentTypeId: longType.id,
        startsAt: `${LOCAL_DATE}T15:30:00Z`,
        ...PATIENT,
      }),
    ).rejects.toMatchObject({ code: "SCHEDULE_CHANGED" });
  });

  it("under concurrent requests for the same slot, exactly one booking succeeds", async () => {
    const doctor = await setupDoctorWithHours();
    const startsAt = `${LOCAL_DATE}T11:00:00Z`;

    const results = await Promise.allSettled([
      bookAppointment(admin, {
        doctorId: doctor.doctorId,
        clinicId: doctor.clinicId,
        appointmentTypeId: doctor.appointmentTypeId,
        startsAt,
        patientName: "Patient One",
        patientPhone: "+216 71 000 001",
        patientEmail: "one@example.test",
      }),
      bookAppointment(admin, {
        doctorId: doctor.doctorId,
        clinicId: doctor.clinicId,
        appointmentTypeId: doctor.appointmentTypeId,
        startsAt,
        patientName: "Patient Two",
        patientPhone: "+216 71 000 002",
        patientEmail: "two@example.test",
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const rejected = results.find((result) => result.status === "rejected");
    if (!rejected || rejected.status !== "rejected") {
      throw new Error("expected exactly one rejection");
    }
    expect(rejected.reason).toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("a booked slot disappears from a follow-up availability call", async () => {
    const doctor = await setupDoctorWithHours();
    const startsAt = `${LOCAL_DATE}T13:00:00Z`;
    const availabilityParams = {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: "2029-01-01T00:00:00Z",
    };

    const before = await fetchAvailableSlots(admin, availabilityParams);
    expect(before.some((slot) => new Date(slot.slotStart).getTime() === new Date(startsAt).getTime())).toBe(
      true,
    );

    await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt,
      ...PATIENT,
    });

    const after = await fetchAvailableSlots(admin, availabilityParams);
    expect(after.some((slot) => new Date(slot.slotStart).getTime() === new Date(startsAt).getTime())).toBe(
      false,
    );
  });

  it("stores only the token hash — the raw token never appears in Postgres", async () => {
    const doctor = await setupDoctorWithHours();
    const result = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T14:00:00Z`,
      ...PATIENT,
    });

    const expectedHash = createHash("sha256").update(result.managementToken).digest("hex");

    const { data: tokenRow, error } = await admin
      .from("appointment_management_tokens")
      .select("token_hash")
      .eq("appointment_id", result.appointment.id)
      .single();
    if (error || !tokenRow) throw new Error(`failed to fetch token row: ${error?.message}`);

    expect(tokenRow.token_hash).toBe(expectedHash);
    expect(tokenRow.token_hash).not.toBe(result.managementToken);

    // Belt and suspenders — the raw token shouldn't show up anywhere else
    // this booking touched either.
    expect(JSON.stringify(result.appointment)).not.toContain(result.managementToken);
  });

  it("creates an email_outbox row with no raw token in its payload", async () => {
    const doctor = await setupDoctorWithHours();
    const result = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T15:00:00Z`,
      ...PATIENT,
    });

    const { data: outboxRow, error } = await admin
      .from("email_outbox")
      .select("to_email, template, payload")
      .eq("payload->>appointment_id", result.appointment.id)
      .maybeSingle();
    if (error) throw new Error(`failed to fetch email_outbox row: ${error.message}`);

    expect(outboxRow).not.toBeNull();
    expect(outboxRow?.to_email).toBe(PATIENT.patientEmail);
    expect(outboxRow?.template).toBe("appointment_confirmation");
    expect(JSON.stringify(outboxRow?.payload)).not.toContain(result.managementToken);
  });
});
