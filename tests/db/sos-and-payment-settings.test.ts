import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupUsers,
  createAnonClient,
  createDoctorFixture,
  createServiceRoleClient,
  type DoctorFixture,
} from "./fixtures";
import { listSosDoctors } from "../../src/lib/doctor-profile/list-sos-doctors";

describe("SOS visibility and private payment configuration", () => {
  const admin = createServiceRoleClient();
  const anon = createAnonClient();
  const userIds: string[] = [];
  let doctor: DoctorFixture;
  let hidden: DoctorFixture;
  const settings = {
    sosEnabled: true,
    sosPhone: "+216 70 123 456",
    sosArea: "Grand Tunis",
    paymentRequired: false,
    paymentMode: "deposit",
    paymentAmountMillimes: 20125,
    paymentTerms: "Refund before 24 hours.",
    recipientName: "Test recipient",
    providerName: "Test provider",
    accountReference: "private-merchant-reference",
  };

  beforeAll(async () => {
    doctor = await createDoctorFixture(admin);
    userIds.push(doctor.user.id);
    hidden = await createDoctorFixture(admin, { isPublished: false });
    userIds.push(hidden.user.id);
    const { error } = await admin
      .from("working_hours")
      .insert({
        doctor_id: doctor.doctorId,
        clinic_id: doctor.clinicId,
        day_of_week: 1,
        start_time: "08:00",
        end_time: "18:00",
      });
    if (error) throw error;
  });
  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("saves public settings and the private recipient, then supports later changes", async () => {
    const saved = await admin.rpc("update_doctor_with_services", {
      p_doctor_id: doctor.doctorId,
      p_services: settings,
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({
      sos_enabled: true,
      payment_amount_millimes: 20125,
      payment_required: false,
    });
    expect(saved.data).not.toHaveProperty("account_reference");
    const account = await admin
      .from("doctor_payment_accounts")
      .select("*")
      .eq("doctor_id", doctor.doctorId)
      .single();
    expect(account.error).toBeNull();
    expect(account.data.account_reference).toBe(settings.accountReference);
    const changed = await admin.rpc("update_doctor_with_services", {
      p_doctor_id: doctor.doctorId,
      p_services: { ...settings, sosArea: "Ariana" },
    });
    expect(changed.error).toBeNull();
    expect(changed.data.sos_area).toBe("Ariana");
  });

  it("lists only published active SOS doctors without recipient details", async () => {
    expect(
      (
        await admin.rpc("update_doctor_with_services", {
          p_doctor_id: hidden.doctorId,
          p_services: settings,
        })
      ).error,
    ).toBeNull();
    const listed = await listSosDoctors(anon);
    expect(listed.some((entry) => entry.id === doctor.doctorId)).toBe(true);
    expect(listed.some((entry) => entry.id === hidden.doctorId)).toBe(false);
    expect(JSON.stringify(listed)).not.toContain(settings.accountReference);
    expect(
      (
        await admin
          .from("doctors")
          .update({ is_published: false, suspended_at: new Date().toISOString() })
          .eq("id", doctor.doctorId)
      ).error,
    ).toBeNull();
    expect((await listSosDoctors(anon)).some((entry) => entry.id === doctor.doctorId)).toBe(false);
    expect(
      (
        await admin
          .from("doctors")
          .update({ suspended_at: null, is_published: true })
          .eq("id", doctor.doctorId)
      ).error,
    ).toBeNull();
  });

  it("denies public and doctor access to recipient details and configuration writes", async () => {
    for (const client of [anon, doctor.client]) {
      expect((await client.from("doctor_payment_accounts").select("*")).error).not.toBeNull();
      expect(
        (
          await client.rpc("update_doctor_with_services", {
            p_doctor_id: doctor.doctorId,
            p_services: settings,
          })
        ).error,
      ).not.toBeNull();
      expect(
        (await client.from("doctors").update({ payment_required: false }).eq("id", doctor.doctorId))
          .error,
      ).not.toBeNull();
    }
  });

  it("rolls back profile and public settings if private recipient validation fails", async () => {
    const before = await admin.from("doctors").select("*").eq("id", doctor.doctorId).single();
    const result = await admin.rpc("update_doctor_with_services", {
      p_doctor_id: doctor.doctorId,
      p_profile: { ...before.data, full_name: "Must roll back" },
      p_services: { ...settings, sosArea: "Must roll back", accountReference: "x".repeat(201) },
    });
    expect(result.error?.code).toBe("23514");
    const after = await admin
      .from("doctors")
      .select("full_name, sos_area")
      .eq("id", doctor.doctorId)
      .single();
    expect(after.data).toEqual({
      full_name: before.data.full_name,
      sos_area: before.data.sos_area,
    });
  });

  it("enforces valid SOS numbers and positive payment amounts in SQL too", async () => {
    for (const invalid of [
      { ...settings, sosPhone: "" },
      { ...settings, paymentRequired: true, paymentAmountMillimes: 0 },
      { ...settings, paymentRequired: true, paymentTerms: "" },
    ]) {
      expect(
        (
          await admin.rpc("update_doctor_with_services", {
            p_doctor_id: doctor.doctorId,
            p_services: invalid,
          })
        ).error?.code,
      ).toBe("23514");
    }
  });

  it("blocks unpaid online bookings through both RPCs and direct inserts", async () => {
    expect(
      (
        await admin.rpc("update_doctor_with_services", {
          p_doctor_id: doctor.doctorId,
          p_services: { ...settings, paymentRequired: true },
        })
      ).error,
    ).toBeNull();
    const args = {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: "2030-03-04T09:00:00Z",
      p_patient_name: "Test",
      p_patient_phone: "+21670123456",
      p_patient_email: "test@example.test",
    };
    expect((await admin.rpc("book_appointment", args)).error?.code).toBe("P0402");
    expect(
      (
        await admin.rpc("book_public_appointment", {
          ...args,
          p_management_token_hash: "a".repeat(64),
          p_management_token_expires_at: "2030-03-05T09:00:00Z",
          p_privacy_consent: true,
          p_adult_confirmation: true,
          p_privacy_policy_version: "test",
        })
      ).error?.code,
    ).toBe("P0402");
    expect(
      (
        await admin
          .from("appointments")
          .insert({
            doctor_id: doctor.doctorId,
            clinic_id: doctor.clinicId,
            appointment_type_id: doctor.appointmentTypeId,
            starts_at: args.p_starts_at,
            ends_at: "2030-03-04T09:30:00Z",
            patient_name: "Test",
            patient_phone: args.p_patient_phone,
          })
      ).error?.code,
    ).toBe("P0402");
    const appointments = await admin
      .from("appointments")
      .select("id")
      .eq("doctor_id", doctor.doctorId);
    expect(appointments.error).toBeNull();
    expect(appointments.data).toEqual([]);
    const tokens = await admin
      .from("appointment_management_tokens")
      .select("id")
      .eq("token_hash", "a".repeat(64));
    expect(tokens.data).toEqual([]);
  });

  it("retains staff manual bookings and restores online booking when prepayment is disabled", async () => {
    const manual = await admin.rpc("create_staff_appointment", {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: "2030-03-04T10:00:00Z",
      p_patient_name: "Manual",
      p_patient_phone: "+21670123456",
      p_patient_email: null,
      p_notes: null,
      p_actor_user_id: doctor.user.id,
    });
    expect(manual.error).toBeNull();
    expect(manual.data.source).toBe("manual");
    expect(
      (
        await admin.rpc("update_doctor_with_services", {
          p_doctor_id: doctor.doctorId,
          p_services: settings,
        })
      ).error,
    ).toBeNull();
    const online = await admin.rpc("book_appointment", {
      p_doctor_id: doctor.doctorId,
      p_clinic_id: doctor.clinicId,
      p_appointment_type_id: doctor.appointmentTypeId,
      p_starts_at: "2030-03-04T11:00:00Z",
      p_patient_name: "Online",
      p_patient_phone: "+21670123456",
      p_patient_email: null,
    });
    expect(online.error).toBeNull();
    expect(online.data.status).toBe("confirmed");
  });
});
