import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture, type DoctorFixture } from "../db/fixtures";
import { fetchAvailableSlots } from "@/lib/availability/fetch-availability-data";
import type { Database } from "@/lib/supabase/database.types";

// Proves the TS slot-generation path (compute-available-slots.ts, driven
// by fetch-availability-data.ts) produces exactly the same slots as the
// authoritative SQL function public.compute_available_slots, across every
// factor both are supposed to account for. If these ever disagree, the SQL
// side is authoritative (it's what book_appointment ultimately relies on
// via private.is_within_working_window, backed by the GiST exclusion
// constraint) — fix the TS side to match, not the other way around.

// tests/db/fixtures.ts's createServiceRoleClient() returns an untyped
// SupabaseClient; fetchAvailableSlots wants SupabaseClient<Database> for
// properly-typed query results, so this test builds its own.
function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type NormalizedSlot = { startMs: number; endMs: number };

function normalize(slots: { slotStart: string; slotEnd: string }[] | { slot_start: string; slot_end: string }[]) {
  return slots
    .map((slot): NormalizedSlot => {
      if ("slotStart" in slot) {
        return { startMs: new Date(slot.slotStart).getTime(), endMs: new Date(slot.slotEnd).getTime() };
      }
      return { startMs: new Date(slot.slot_start).getTime(), endMs: new Date(slot.slot_end).getTime() };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

async function assertParity(
  admin: SupabaseClient<Database>,
  params: {
    doctorId: string;
    clinicId: string;
    appointmentTypeId: string;
    localDate: string;
    now: string;
  },
) {
  const { data: sqlSlots, error: sqlError } = await admin.rpc("compute_available_slots", {
    p_doctor_id: params.doctorId,
    p_clinic_id: params.clinicId,
    p_appointment_type_id: params.appointmentTypeId,
    p_local_date: params.localDate,
    p_now: params.now,
  });
  if (sqlError) throw new Error(`compute_available_slots RPC failed: ${sqlError.message}`);

  const tsSlots = await fetchAvailableSlots(admin, params);

  const normalizedSql = normalize(sqlSlots ?? []);
  const normalizedTs = normalize(tsSlots);

  expect(normalizedTs).toEqual(normalizedSql);
  return normalizedSql;
}

const LOCAL_DATE = "2030-02-04"; // Monday
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();
const FAR_PAST_NOW = "2029-01-01T00:00:00Z";

describe("SQL vs TypeScript availability parity (Africa/Tunis fixtures)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  async function setupDoctor(opts: Parameters<typeof createDoctorFixture>[1] = {}): Promise<DoctorFixture> {
    const doctor = await createDoctorFixture(admin, opts);
    userIds.push(doctor.user.id);
    return doctor;
  }

  it("agree on plain recurring working hours", async () => {
    const doctor = await setupDoctor();
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(4);
  });

  it("agree when a break subtracts from the window", async () => {
    const doctor = await setupDoctor();
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });
    await admin.from("breaks").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "10:00",
      end_time: "10:30",
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(3);
  });

  it("agree when a blocked period subtracts from the window", async () => {
    const doctor = await setupDoctor();
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });
    await admin.from("blocked_periods").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      starts_at: `${LOCAL_DATE}T08:30:00Z`,
      ends_at: `${LOCAL_DATE}T09:00:00Z`,
      reason: "test",
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(3);
  });

  it("agree when a schedule exception closes a normally-open date", async () => {
    const doctor = await setupDoctor();
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });
    await admin.from("schedule_exceptions").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      date: LOCAL_DATE,
      is_closed: true,
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(0);
  });

  it("agree when a schedule exception opens a normally-closed date with custom hours", async () => {
    const doctor = await setupDoctor();
    // deliberately no working_hours row for DAY_OF_WEEK
    await admin.from("schedule_exceptions").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      date: LOCAL_DATE,
      is_closed: false,
      start_time: "14:00",
      end_time: "15:00",
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(2);
  });

  it("agree on a longer appointment-type duration", async () => {
    const doctor = await setupDoctor();
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });
    const { data: longType, error } = await admin
      .from("appointment_types")
      .insert({ doctor_id: doctor.doctorId, name: "Long consult", duration_minutes: 60 })
      .select()
      .single();
    if (error || !longType) throw new Error(`failed to create appointment type: ${error?.message}`);

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: longType.id,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(2);
  });

  it("agree when minimum booking notice excludes near-term slots", async () => {
    const doctor = await setupDoctor({ minBookingNoticeMinutes: 90 });
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: `${LOCAL_DATE}T07:30:00Z`, // + 90 min = 09:00 UTC cutoff
    });
    expect(slots).toHaveLength(2);
  });

  it("agree when an existing confirmed appointment blocks a slot", async () => {
    const doctor = await setupDoctor();
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "09:00",
      end_time: "11:00",
    });
    await admin.from("appointments").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      appointment_type_id: doctor.appointmentTypeId,
      patient_name: "Existing patient",
      patient_phone: "+21600000099",
      starts_at: `${LOCAL_DATE}T09:00:00Z`,
      ends_at: `${LOCAL_DATE}T09:30:00Z`,
      status: "confirmed",
    });

    const slots = await assertParity(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      localDate: LOCAL_DATE,
      now: FAR_PAST_NOW,
    });
    expect(slots).toHaveLength(3);
  });
});
