import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "../src/lib/supabase/env";
import type { Database } from "../src/lib/supabase/database.types";

// Not importing service-role.ts directly: it starts with `import
// "server-only"`, which unconditionally throws outside Next's bundler (it
// only resolves to a no-op via the "react-server" export condition Next
// sets up — plain tsx/node doesn't). This script needs the same privileged
// client, so it constructs it the same way service-role.ts does, using the
// same env helpers (which carry no such guard).
function createServiceRoleClient() {
  return createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Minimal .env.local loader — this script runs via `tsx`, outside Next.js,
// so nothing loads .env.local for us automatically.
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));

// createServiceRoleClient() reads env vars lazily when called (inside
// main(), below), so it's fine that the import above is evaluated before
// loadEnvFile() runs.

const DOCTOR_EMAIL = "amira.bensalah@example.test";
const DOCTOR_SLUG = "amira-ben-salah";

async function main() {
  const admin = createServiceRoleClient();

  const { data: existingDoctor, error: existingDoctorError } = await admin
    .from("doctors")
    .select("id")
    .eq("slug", DOCTOR_SLUG)
    .maybeSingle();
  if (existingDoctorError) {
    throw new Error(`checking for existing doctor: ${existingDoctorError.message}`);
  }
  if (existingDoctor) {
    console.log(`Doctor "${DOCTOR_SLUG}" already exists (id=${existingDoctor.id}) — nothing to do.`);
    return;
  }

  const { data: specialty, error: specialtyError } = await admin
    .from("specialties")
    .upsert(
      { slug: "cardiologie", name_fr: "Cardiologie", name_ar: "أمراض القلب" },
      { onConflict: "slug" },
    )
    .select()
    .single();
  if (specialtyError || !specialty) {
    throw new Error(`specialty: ${specialtyError?.message}`);
  }

  const { data: existingUsers, error: listUsersError } = await admin.auth.admin.listUsers();
  if (listUsersError) {
    throw new Error(`listing auth users: ${listUsersError.message}`);
  }

  let userId = existingUsers.users.find((u) => u.email === DOCTOR_EMAIL)?.id;
  if (!userId) {
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email: DOCTOR_EMAIL,
      password: "local-dev-only-not-a-real-password",
      email_confirm: true,
    });
    if (userError || !created.user) {
      throw new Error(`creating auth user: ${userError?.message}`);
    }
    userId = created.user.id;
  }

  const { data: doctor, error: doctorError } = await admin
    .from("doctors")
    .insert({
      user_id: userId,
      specialty_id: specialty.id,
      full_name: "Dr. Amira Ben Salah",
      bio: "Cardiologue diplômée de la Faculté de Médecine de Tunis, le Dr Amira Ben Salah exerce depuis douze ans à Tunis. Elle est spécialisée dans la prise en charge des maladies cardiovasculaires et l'échocardiographie, avec une attention particulière portée à la prévention et au suivi au long cours de ses patients.",
      phone: "+216 71 234 567",
      slug: DOCTOR_SLUG,
      default_locale: "fr",
      timezone: "Africa/Tunis",
      min_booking_notice_minutes: 60,
      is_published: true,
    })
    .select()
    .single();
  if (doctorError || !doctor) {
    throw new Error(`doctor: ${doctorError?.message}`);
  }

  const { data: clinic, error: clinicError } = await admin
    .from("clinics")
    .insert({
      doctor_id: doctor.id,
      name: "Clinique El Manar",
      address: "12 Avenue Habib Bourguiba, 1002 Tunis, Tunisie",
      city: "Tunis",
      timezone: "Africa/Tunis",
    })
    .select()
    .single();
  if (clinicError || !clinic) throw new Error(`clinic: ${clinicError?.message}`);

  const { error: appointmentTypeError } = await admin
    .from("appointment_types")
    .insert({ doctor_id: doctor.id, name: "Consultation", duration_minutes: 30 });
  if (appointmentTypeError) throw new Error(`appointment type: ${appointmentTypeError.message}`);

  // Monday-Friday 09:00-17:00 with a lunch break, so the M4 booking
  // widget has real slots to show against this fictional doctor.
  const weekdays = [1, 2, 3, 4, 5]; // Postgres dow: Monday=1 ... Friday=5
  const { error: workingHoursError } = await admin.from("working_hours").insert(
    weekdays.map((dayOfWeek) => ({
      doctor_id: doctor.id,
      clinic_id: clinic.id,
      day_of_week: dayOfWeek,
      start_time: "09:00",
      end_time: "17:00",
    })),
  );
  if (workingHoursError) throw new Error(`working hours: ${workingHoursError.message}`);

  const { error: breaksError } = await admin.from("breaks").insert(
    weekdays.map((dayOfWeek) => ({
      doctor_id: doctor.id,
      clinic_id: clinic.id,
      day_of_week: dayOfWeek,
      start_time: "12:00",
      end_time: "13:00",
    })),
  );
  if (breaksError) throw new Error(`breaks: ${breaksError.message}`);

  const { error: qualificationsError } = await admin.from("doctor_qualifications").insert([
    {
      doctor_id: doctor.id,
      title: "Doctorat en Médecine",
      institution: "Faculté de Médecine de Tunis",
      year_obtained: 2008,
    },
    {
      doctor_id: doctor.id,
      title: "Diplôme d'études spécialisées en Cardiologie",
      institution: "Faculté de Médecine de Tunis",
      year_obtained: 2013,
    },
    {
      doctor_id: doctor.id,
      title: "Fellowship en Échocardiographie",
      institution: "Hôpital Européen Georges-Pompidou, Paris",
      year_obtained: 2015,
    },
  ]);
  if (qualificationsError) throw new Error(`qualifications: ${qualificationsError.message}`);

  const { error: publicationsError } = await admin.from("doctor_publications").insert([
    {
      doctor_id: doctor.id,
      title: "Prise en charge de l'insuffisance cardiaque en Tunisie : étude rétrospective",
      publication_name: "Tunisie Médicale",
      published_year: 2019,
      url: "https://example.test/publications/insuffisance-cardiaque",
    },
    {
      doctor_id: doctor.id,
      title: "Échocardiographie de stress : indications et limites",
      publication_name: "La Tunisie Chirurgicale",
      published_year: 2021,
      url: null,
    },
  ]);
  if (publicationsError) throw new Error(`publications: ${publicationsError.message}`);

  const { error: booksError } = await admin.from("doctor_books").insert([
    {
      doctor_id: doctor.id,
      title: "Comprendre son cœur : guide pratique pour les patients",
      publisher: "Éditions Sud Santé",
      published_year: 2022,
      url: null,
    },
  ]);
  if (booksError) throw new Error(`books: ${booksError.message}`);

  const { error: mediaError } = await admin.from("doctor_media_appearances").insert([
    {
      doctor_id: doctor.id,
      title: "Comment préserver la santé de son cœur après 40 ans",
      outlet: "Radio Mosaïque FM",
      url: null,
      appeared_on: "2023-09-12",
    },
    {
      doctor_id: doctor.id,
      title: "Journée mondiale du cœur : entretien avec le Dr Ben Salah",
      outlet: "La Presse de Tunisie",
      url: null,
      appeared_on: "2024-09-29",
    },
  ]);
  if (mediaError) throw new Error(`media appearances: ${mediaError.message}`);

  console.log(`Seeded doctor "${doctor.full_name}" (slug=${doctor.slug}, id=${doctor.id}).`);
}

// process.exitCode (not process.exit()) lets Node drain pending handles
// naturally — forcing an immediate exit here raced with supabase-js's
// internal handle cleanup and crashed with a libuv assertion on Windows.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
