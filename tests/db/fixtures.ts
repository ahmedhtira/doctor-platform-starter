import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getTestSupabaseAnonKey, getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "./env";

// Exported so tests/e2e/dashboard-fixtures.ts can log fixture users in
// through the real /login form — the fixture creates the auth user with
// this password (createTestUser below), so the e2e layer needs the same
// value rather than a second, driftable copy.
export const TEST_PASSWORD = "Test-password-123!";
let counter = 0;

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

export function createServiceRoleClient(): SupabaseClient {
  return createClient(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createAnonClient(): SupabaseClient {
  return createClient(getTestSupabaseUrl(), getTestSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function createTestUser(admin: SupabaseClient, prefix: string): Promise<User> {
  const email = `${unique(prefix)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`failed to create test user (${prefix}): ${error?.message}`);
  }
  return data.user;
}

export async function signInAsTestUser(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) {
    throw new Error(`failed to sign in as ${email}: ${error.message}`);
  }
  return client;
}

export async function createSpecialty(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin
    .from("specialties")
    .insert({ slug: unique("specialty"), name_fr: "Test", name_ar: "اختبار" })
    .select("id")
    .single();
  if (error) throw new Error(`failed to create specialty: ${error.message}`);
  return data.id as string;
}

export interface DoctorFixture {
  user: { id: string; email: string };
  client: SupabaseClient;
  doctorId: string;
  clinicId: string;
  appointmentTypeId: string;
}

export async function createDoctorFixture(
  admin: SupabaseClient,
  opts: {
    timezone?: string;
    isPublished?: boolean;
    minBookingNoticeMinutes?: number;
  } = {},
): Promise<DoctorFixture> {
  const user = await createTestUser(admin, "doctor");
  const specialtyId = await createSpecialty(admin);

  const { data: doctor, error: doctorError } = await admin
    .from("doctors")
    .insert({
      user_id: user.id,
      specialty_id: specialtyId,
      full_name: "Dr. Test",
      slug: unique("dr-test"),
      default_locale: "fr",
      timezone: opts.timezone ?? "Africa/Tunis",
      is_published: opts.isPublished ?? true,
      min_booking_notice_minutes: opts.minBookingNoticeMinutes ?? 60,
    })
    .select()
    .single();
  if (doctorError) throw new Error(`failed to create doctor: ${doctorError.message}`);

  const { data: clinic, error: clinicError } = await admin
    .from("clinics")
    .insert({
      doctor_id: doctor.id,
      name: "Main clinic",
      address: "1 Test St",
      timezone: opts.timezone ?? "Africa/Tunis",
    })
    .select()
    .single();
  if (clinicError) throw new Error(`failed to create clinic: ${clinicError.message}`);

  const { data: appointmentType, error: typeError } = await admin
    .from("appointment_types")
    .insert({ doctor_id: doctor.id, name: "Consultation", duration_minutes: 30 })
    .select()
    .single();
  if (typeError) throw new Error(`failed to create appointment type: ${typeError.message}`);

  const client = await signInAsTestUser(user.email!);

  return {
    user: { id: user.id, email: user.email! },
    client,
    doctorId: doctor.id as string,
    clinicId: clinic.id as string,
    appointmentTypeId: appointmentType.id as string,
  };
}

export async function createSecretaryFixture(
  admin: SupabaseClient,
  doctorId: string,
): Promise<{ user: { id: string; email: string }; client: SupabaseClient }> {
  const user = await createTestUser(admin, "secretary");
  const { error } = await admin
    .from("doctor_secretaries")
    .insert({ doctor_id: doctorId, secretary_user_id: user.id });
  if (error) throw new Error(`failed to link secretary: ${error.message}`);

  const client = await signInAsTestUser(user.email!);
  return { user: { id: user.id, email: user.email! }, client };
}

export async function cleanupUsers(admin: SupabaseClient, userIds: string[]): Promise<void> {
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
  }
}
