import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture, createSecretaryFixture, type DoctorFixture } from "../db/fixtures";
import { bookAppointment } from "@/lib/booking/book-appointment";
import { cancelStaffAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import { recordStaffAppointmentOutcome } from "@/lib/dashboard/record-staff-appointment-outcome";
import { ManageError } from "@/lib/booking/manage-errors";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the M8 DI core dashboard/actions.ts's recordAppointmentOutcomeAction
// calls. Staff-path authorization (is the actor the doctor owner or one of
// their secretaries) mirrors the already-covered cancel/reschedule
// authorization shape — this file focuses on the outcome-specific
// preconditions (ends_at <= now(), status must be 'confirmed') and, per the
// required correction on this milestone, the row-lock that makes those
// checks safe under concurrent conflicting requests.

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const LOCAL_DATE = "2031-09-03";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

const PATIENT = {
  patientName: "Outcome Test Patient",
  patientPhone: "+216 71 000 050",
  patientEmail: "outcome-test-patient@example.test",
};

describe("recordStaffAppointmentOutcome (M8)", () => {
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

  /**
   * book_appointment itself refuses a past/too-soon starts_at, so every
   * fixture here books a valid future in-hours slot and then backdates
   * starts_at/ends_at directly via a service-role update — the same
   * technique tests/db/management-tokens.test.ts already uses to backdate
   * appointment_management_sessions.expires_at for its expired-session case.
   */
  async function bookEndedAppointment(doctor: DoctorFixture, startsAtLocalTime: string) {
    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T${startsAtLocalTime}Z`,
      ...PATIENT,
    });

    const { error } = await admin
      .from("appointments")
      .update({ starts_at: "2020-01-01T09:00:00Z", ends_at: "2020-01-01T09:30:00Z" })
      .eq("id", booked.appointment.id);
    if (error) throw new Error(`failed to backdate appointment: ${error.message}`);

    return booked;
  }

  it("lets the doctor owner record completed on an ended, confirmed appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookEndedAppointment(doctor, "09:00:00");

    const result = await recordStaffAppointmentOutcome(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
      outcome: "completed",
    });

    expect(result.id).toBe(booked.appointment.id);
    expect(result.status).toBe("completed");
  });

  it("lets a secretary record no_show on an ended, confirmed appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const secretary = await createSecretaryFixture(admin, doctor.doctorId);
    userIds.push(secretary.user.id);
    const booked = await bookEndedAppointment(doctor, "10:00:00");

    const result = await recordStaffAppointmentOutcome(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: secretary.user.id,
      outcome: "no_show",
    });

    expect(result.status).toBe("no_show");
  });

  it("rejects an actor who has no staff relationship to the doctor", async () => {
    const doctor = await setupDoctorWithHours();
    const otherDoctor = await createDoctorFixture(admin);
    userIds.push(otherDoctor.user.id);
    const booked = await bookEndedAppointment(doctor, "11:00:00");

    await expect(
      recordStaffAppointmentOutcome(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: otherDoctor.user.id,
        outcome: "completed",
      }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects an appointment that hasn't ended yet", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T12:00:00Z`,
      ...PATIENT,
    });

    await expect(
      recordStaffAppointmentOutcome(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: doctor.user.id,
        outcome: "completed",
      }),
    ).rejects.toMatchObject({ code: "NOT_YET_ENDED" });
  });

  it("rejects an appointment that is already cancelled", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookEndedAppointment(doctor, "13:00:00");
    await cancelStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
    });

    await expect(
      recordStaffAppointmentOutcome(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: doctor.user.id,
        outcome: "no_show",
      }),
    ).rejects.toMatchObject({ code: "NOT_MODIFIABLE" });
  });

  it("rejects a second outcome recording on an already-completed appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookEndedAppointment(doctor, "14:00:00");

    await recordStaffAppointmentOutcome(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
      outcome: "completed",
    });

    await expect(
      recordStaffAppointmentOutcome(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: doctor.user.id,
        outcome: "no_show",
      }),
    ).rejects.toBeInstanceOf(ManageError);
  });

  it("a concurrent conflicting request cannot overwrite the outcome once the row is no longer confirmed", async () => {
    // Proves the required correction: record_appointment_outcome locks the
    // row (`for update`) before its precondition checks, not just before
    // the write. Two calls race for the same ended, confirmed appointment
    // with different outcomes — without the lock, both could read
    // status = 'confirmed' before either commits and both would then
    // "succeed", the second silently overwriting the first's result with
    // no error. With the lock, Postgres serializes the two transactions at
    // the SELECT ... FOR UPDATE step: whichever commits first wins, and
    // the second re-reads the now-updated row and correctly rejects with
    // NOT_MODIFIABLE instead of blindly applying its own update.
    const doctor = await setupDoctorWithHours();
    const booked = await bookEndedAppointment(doctor, "15:00:00");

    const [completedResult, noShowResult] = await Promise.allSettled([
      recordStaffAppointmentOutcome(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: doctor.user.id,
        outcome: "completed",
      }),
      recordStaffAppointmentOutcome(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: doctor.user.id,
        outcome: "no_show",
      }),
    ]);

    const outcomes = [completedResult, noShowResult];
    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");

    // Exactly one of the two concurrent calls won the race.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ManageError);
    expect((rejection.reason as ManageError).code).toBe("NOT_MODIFIABLE");

    const winner = fulfilled[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof recordStaffAppointmentOutcome>>
    >;
    expect(["completed", "no_show"]).toContain(winner.value.status);

    // The persisted row matches exactly the winning call's outcome — not
    // some mixed/corrupted state, and not silently re-applied by the loser.
    const { data: finalRow, error } = await admin
      .from("appointments")
      .select("status")
      .eq("id", booked.appointment.id)
      .single();
    if (error) throw new Error(error.message);
    expect(finalRow.status).toBe(winner.value.status);
  });
});
