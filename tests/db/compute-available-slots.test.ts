import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

// Every doctor fixture defaults to Africa/Tunis (fixed UTC+1, no DST) —
// used deliberately per the requirement to exercise clinic-timezone
// conversion with a concrete, verifiable offset.
const LOCAL_DATE = "2030-01-07";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();
const FAR_PAST_NOW = "2029-01-01T00:00:00Z";

describe("compute_available_slots", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  async function setupDoctor(opts: { minBookingNoticeMinutes?: number } = {}): Promise<DoctorFixture> {
    const doctor = await createDoctorFixture(admin, {
      timezone: "Africa/Tunis",
      minBookingNoticeMinutes: opts.minBookingNoticeMinutes ?? 60,
    });
    userIds.push(doctor.user.id);
    return doctor;
  }

  async function insertWorkingHours(doctor: DoctorFixture, start: string, end: string) {
    const { error } = await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: start,
      end_time: end,
    });
    if (error) throw new Error(`failed to insert working_hours: ${error.message}`);
  }

  async function callSlots(
    doctor: DoctorFixture,
    now = FAR_PAST_NOW,
    appointmentTypeId = doctor.appointmentTypeId,
  ) {
    const { data, error } = await admin.rpc("compute_available_slots", {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: appointmentTypeId,
      p_local_date: LOCAL_DATE,
      p_now: now,
    });
    if (error) throw new Error(`compute_available_slots failed: ${error.message}`);
    return data as { slot_start: string; slot_end: string }[];
  }

  it("derives 30-minute slots from recurring working hours, converted from Africa/Tunis", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");

    const slots = await callSlots(doctor);

    expect(slots).toHaveLength(4);
    // Africa/Tunis is fixed UTC+1 year-round — 09:00 local = 08:00 UTC.
    expect(new Date(slots[0].slot_start).toISOString()).toBe("2030-01-07T08:00:00.000Z");
    expect(new Date(slots[3].slot_end).toISOString()).toBe("2030-01-07T10:00:00.000Z");
  });

  it("returns no slots for a day with no working hours and no exception", async () => {
    const doctor = await setupDoctor();
    expect(await callSlots(doctor)).toHaveLength(0);
  });

  it("subtracts a break from the working window", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");
    await admin.from("breaks").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: DAY_OF_WEEK,
      start_time: "10:00",
      end_time: "10:30",
    });

    const slots = await callSlots(doctor);
    expect(slots).toHaveLength(3);
    // Break is 10:00-10:30 Tunis = 09:00-09:30 UTC — that slot is gone,
    // the untouched 08:00 UTC slot is not.
    expect(slots.some((s) => new Date(s.slot_start).toISOString() === "2030-01-07T08:00:00.000Z")).toBe(true);
    expect(slots.some((s) => new Date(s.slot_start).toISOString() === "2030-01-07T09:00:00.000Z")).toBe(false);
  });

  it("subtracts a blocked period from the working window", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");
    await admin.from("blocked_periods").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      starts_at: "2030-01-07T08:30:00Z",
      ends_at: "2030-01-07T09:00:00Z",
      reason: "vacation",
    });

    const slots = await callSlots(doctor);
    expect(slots).toHaveLength(3);
    expect(slots.some((s) => new Date(s.slot_start).toISOString() === "2030-01-07T08:30:00.000Z")).toBe(false);
  });

  it("schedule_exceptions: closes a normally-open date", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");
    await admin.from("schedule_exceptions").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      date: LOCAL_DATE,
      is_closed: true,
    });

    expect(await callSlots(doctor)).toHaveLength(0);
  });

  it("schedule_exceptions: opens a normally-closed date with custom hours", async () => {
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

    const slots = await callSlots(doctor);
    expect(slots).toHaveLength(2);
    expect(new Date(slots[0].slot_start).toISOString()).toBe("2030-01-07T13:00:00.000Z");
  });

  it("schedule_exceptions: substitutes exceptional hours over the recurring pattern", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");
    await admin.from("schedule_exceptions").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      date: LOCAL_DATE,
      is_closed: false,
      start_time: "13:00",
      end_time: "14:00",
    });

    const slots = await callSlots(doctor);
    expect(slots).toHaveLength(2);
    expect(new Date(slots[0].slot_start).toISOString()).toBe("2030-01-07T12:00:00.000Z");
  });

  it("respects the appointment type's duration when chunking slots", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");

    const { data: longType, error } = await admin
      .from("appointment_types")
      .insert({ doctor_id: doctor.doctorId, name: "Long consult", duration_minutes: 60 })
      .select()
      .single();
    if (error) throw new Error(error.message);

    expect(await callSlots(doctor, FAR_PAST_NOW, longType.id)).toHaveLength(2);
  });

  it("excludes slots inside the minimum booking notice window", async () => {
    const doctor = await setupDoctor({ minBookingNoticeMinutes: 90 });
    await insertWorkingHours(doctor, "09:00", "11:00"); // 08:00-10:00 UTC, 4 slots

    // now=07:30 UTC + 90 min notice = 09:00 UTC cutoff.
    const slots = await callSlots(doctor, "2030-01-07T07:30:00Z");

    expect(slots).toHaveLength(2);
    for (const s of slots) {
      expect(new Date(s.slot_start).getTime()).toBeGreaterThanOrEqual(
        new Date("2030-01-07T09:00:00Z").getTime(),
      );
    }
  });

  it("excludes a slot covered by a confirmed appointment, but not a cancelled one", async () => {
    const doctor = await setupDoctor();
    await insertWorkingHours(doctor, "09:00", "11:00");

    const { data: appt, error } = await admin
      .from("appointments")
      .insert({
        doctor_id: doctor.doctorId,
        clinic_id: doctor.clinicId,
        appointment_type_id: doctor.appointmentTypeId,
        patient_name: "Existing patient",
        patient_phone: "+21600000099",
        starts_at: "2030-01-07T09:00:00Z",
        ends_at: "2030-01-07T09:30:00Z",
        status: "confirmed",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    const withConfirmed = await callSlots(doctor);
    expect(withConfirmed).toHaveLength(3);
    expect(
      withConfirmed.some((s) => new Date(s.slot_start).toISOString() === "2030-01-07T09:00:00.000Z"),
    ).toBe(false);

    await admin.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);

    expect(await callSlots(doctor)).toHaveLength(4);
  });
});
