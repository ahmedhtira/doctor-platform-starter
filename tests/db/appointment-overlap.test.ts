import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";

// The GiST exclusion constraint on appointments is the final no-overlap
// invariant, independent of the application-level checks in
// book_appointment/compute_available_slots.
describe("appointment overlap", () => {
  const admin = createServiceRoleClient();
  const userIds: string[] = [];
  let doctor: DoctorFixture;

  beforeAll(async () => {
    doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);

    // book_appointment (used by the last test below) validates against
    // working_hours — cover the whole day for the date it uses.
    await admin.from("working_hours").insert({
      doctor_id: doctor.doctorId,
      clinic_id: doctor.clinicId,
      day_of_week: new Date("2030-03-04T00:00:00Z").getUTCDay(),
      start_time: "00:00",
      end_time: "23:59",
    });
  });

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  const baseAppointment = (overrides: Record<string, unknown>) => ({
    doctor_id: doctor.doctorId,
    clinic_id: doctor.clinicId,
    appointment_type_id: doctor.appointmentTypeId,
    patient_name: "Patient Test",
    patient_phone: "+21600000000",
    status: "confirmed",
    ...overrides,
  });

  it("rejects a directly-inserted confirmed appointment overlapping an existing one", async () => {
    const { error: firstError } = await admin.from("appointments").insert(
      baseAppointment({ starts_at: "2030-03-01T09:00:00Z", ends_at: "2030-03-01T09:30:00Z" }),
    );
    expect(firstError).toBeNull();

    const { error: overlapError } = await admin.from("appointments").insert(
      baseAppointment({ starts_at: "2030-03-01T09:15:00Z", ends_at: "2030-03-01T09:45:00Z" }),
    );
    expect(overlapError).not.toBeNull();
    expect(overlapError?.code).toBe("23P01");
  });

  it("accepts a back-to-back, non-overlapping appointment", async () => {
    const { error } = await admin.from("appointments").insert(
      baseAppointment({ starts_at: "2030-03-01T09:30:00Z", ends_at: "2030-03-01T10:00:00Z" }),
    );
    expect(error).toBeNull();
  });

  it("frees the slot once the conflicting appointment is cancelled", async () => {
    const { data: original } = await admin
      .from("appointments")
      .insert(baseAppointment({ starts_at: "2030-03-02T09:00:00Z", ends_at: "2030-03-02T09:30:00Z" }))
      .select()
      .single();

    const { error: rebookBeforeCancel } = await admin.from("appointments").insert(
      baseAppointment({ starts_at: "2030-03-02T09:00:00Z", ends_at: "2030-03-02T09:30:00Z" }),
    );
    expect(rebookBeforeCancel?.code).toBe("23P01");

    await admin.from("appointments").update({ status: "cancelled" }).eq("id", original.id);

    const { error: rebookAfterCancel } = await admin.from("appointments").insert(
      baseAppointment({ starts_at: "2030-03-02T09:00:00Z", ends_at: "2030-03-02T09:30:00Z" }),
    );
    expect(rebookAfterCancel).toBeNull();
  });

  it("does not let completed/no_show appointments block new bookings at the same time", async () => {
    const { data: original } = await admin
      .from("appointments")
      .insert(baseAppointment({ starts_at: "2030-03-03T09:00:00Z", ends_at: "2030-03-03T09:30:00Z" }))
      .select()
      .single();

    await admin.from("appointments").update({ status: "completed" }).eq("id", original.id);

    const { error } = await admin.from("appointments").insert(
      baseAppointment({ starts_at: "2030-03-03T09:00:00Z", ends_at: "2030-03-03T09:30:00Z" }),
    );
    expect(error).toBeNull();
  });

  it("book_appointment: second call for the same slot fails with 'slot unavailable'", async () => {
    const args = {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: "2030-03-04T09:00:00Z",
      p_patient_name: "Patient One",
      p_patient_phone: "+21600000001",
      p_patient_email: null,
    };

    const first = await admin.rpc("book_appointment", args);
    expect(first.error).toBeNull();

    const second = await admin.rpc("book_appointment", {
      ...args,
      p_patient_name: "Patient Two",
      p_patient_phone: "+21600000002",
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23P01");
  });
});
