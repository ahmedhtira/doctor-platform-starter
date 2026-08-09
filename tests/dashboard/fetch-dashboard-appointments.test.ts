import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers, createDoctorFixture, type DoctorFixture } from "../db/fixtures";
import { fetchDashboardAppointments } from "@/lib/dashboard/fetch-dashboard-appointments";
import type { Database } from "@/lib/supabase/database.types";

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function insertAppointment(
  admin: SupabaseClient<Database>,
  doctor: DoctorFixture,
  startsAt: string,
  patientName: string,
) {
  const { data, error } = await admin
    .from("appointments")
    .insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      appointment_type_id: doctor.appointmentTypeId,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + 30 * 60 * 1000).toISOString(),
      patient_name: patientName,
      patient_phone: "+216 71 000 000",
    })
    .select()
    .single();
  if (error) throw new Error(`failed to insert appointment: ${error.message}`);
  return data;
}

describe("fetchDashboardAppointments (M6)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("only returns appointments within [rangeStart, rangeEnd)", async () => {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);

    await insertAppointment(admin, doctor, "2031-03-01T09:00:00Z", "Before Range");
    const inRange = await insertAppointment(admin, doctor, "2031-03-02T09:00:00Z", "In Range");
    await insertAppointment(admin, doctor, "2031-03-03T09:00:00Z", "After Range");

    const result = await fetchDashboardAppointments(admin, {
      doctorId: doctor.doctorId,
      rangeStart: "2031-03-02T00:00:00Z",
      rangeEnd: "2031-03-03T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(inRange.id);
    expect(result[0].patientName).toBe("In Range");
  });

  it("joins clinic and appointment-type names correctly", async () => {
    const doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    await insertAppointment(admin, doctor, "2031-04-01T09:00:00Z", "Join Test Patient");

    const result = await fetchDashboardAppointments(admin, {
      doctorId: doctor.doctorId,
      rangeStart: "2031-04-01T00:00:00Z",
      rangeEnd: "2031-04-02T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].clinicId).toBe(doctor.clinicId);
    expect(result[0].clinicName).toBe("Main clinic");
    expect(result[0].clinicTimezone).toBe("Africa/Tunis");
    expect(result[0].appointmentTypeId).toBe(doctor.appointmentTypeId);
    expect(result[0].appointmentTypeName).toBe("Consultation");
  });

  it("never returns another doctor's appointments", async () => {
    const doctorA = await createDoctorFixture(admin);
    userIds.push(doctorA.user.id);
    const doctorB = await createDoctorFixture(admin);
    userIds.push(doctorB.user.id);

    await insertAppointment(admin, doctorA, "2031-05-01T09:00:00Z", "Doctor A Patient");
    await insertAppointment(admin, doctorB, "2031-05-01T10:00:00Z", "Doctor B Patient");

    const result = await fetchDashboardAppointments(admin, {
      doctorId: doctorA.doctorId,
      rangeStart: "2031-05-01T00:00:00Z",
      rangeEnd: "2031-05-02T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].patientName).toBe("Doctor A Patient");
  });
});
