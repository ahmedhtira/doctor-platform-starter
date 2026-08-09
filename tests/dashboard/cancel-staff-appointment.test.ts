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
import { cancelStaffAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import { ManageError } from "@/lib/booking/manage-errors";
import type { Database } from "@/lib/supabase/database.types";

// Exercises the M6 DI core dashboard/actions.ts's cancelAppointmentAction
// calls. Staff-path authorization itself (is the actor the doctor owner or
// one of their secretaries) is already covered at the RPC level by
// tests/db/rls.test.ts / tests/db/reschedule-appointment.test.ts — this
// file only proves the DI core delegates correctly.

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const LOCAL_DATE = "2031-06-02";
const DAY_OF_WEEK = new Date(`${LOCAL_DATE}T00:00:00Z`).getUTCDay();

const PATIENT = {
  patientName: "Staff Cancel Test Patient",
  patientPhone: "+216 71 000 020",
  patientEmail: "staff-cancel-patient@example.test",
};

describe("cancelStaffAppointment (M6)", () => {
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

  it("cancels the appointment when the actor is the doctor owner", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T09:00:00Z`,
      ...PATIENT,
    });

    const result = await cancelStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
    });

    expect(result.id).toBe(booked.appointment.id);
    expect(result.status).toBe("cancelled");
  });

  it("cancels the appointment when the actor is one of the doctor's secretaries", async () => {
    const doctor = await setupDoctorWithHours();
    const secretary = await createSecretaryFixture(admin, doctor.doctorId);
    userIds.push(secretary.user.id);
    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T10:00:00Z`,
      ...PATIENT,
    });

    const result = await cancelStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: secretary.user.id,
    });

    expect(result.status).toBe("cancelled");
  });

  it("rejects an actor who has no staff relationship to the doctor", async () => {
    const doctor = await setupDoctorWithHours();
    const otherDoctor = await createDoctorFixture(admin);
    userIds.push(otherDoctor.user.id);
    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T11:00:00Z`,
      ...PATIENT,
    });

    await expect(
      cancelStaffAppointment(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: otherDoctor.user.id,
      }),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects a second cancellation of the same appointment", async () => {
    const doctor = await setupDoctorWithHours();
    const booked = await bookAppointment(admin, {
      doctorId: doctor.doctorId,
      clinicId: doctor.clinicId,
      appointmentTypeId: doctor.appointmentTypeId,
      startsAt: `${LOCAL_DATE}T12:00:00Z`,
      ...PATIENT,
    });

    await cancelStaffAppointment(admin, {
      appointmentId: booked.appointment.id,
      actorUserId: doctor.user.id,
    });

    await expect(
      cancelStaffAppointment(admin, {
        appointmentId: booked.appointment.id,
        actorUserId: doctor.user.id,
      }),
    ).rejects.toBeInstanceOf(ManageError);
  });
});
