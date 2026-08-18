import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { EmailSender } from "@/lib/email/send-email";
import { sendAccountEmail } from "@/lib/email/send-account-email";
import { AdminError } from "./admin-errors";

export type ProvisionDoctorPhoto = {
  body: ArrayBuffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};
export type ProvisionDoctorInput = {
  adminActorUserId: string;
  email: string;
  fullName: string;
  specialtyId: string;
  slug: string;
  defaultLocale: string;
  timezone: string;
  bio?: string;
  phone?: string;
  photo?: ProvisionDoctorPhoto;
  pageVariant: "standard" | "custom";
  customTemplateKey?: string | null;
  clinic: { name: string; address: string; city?: string | null; timezone: string };
  appointmentType: { name: string; durationMinutes: number };
  workingDays: number[];
  workingStartTime: string;
  workingEndTime: string;
  redirectTo: string;
};

export type ProvisionedDoctor = Database["public"]["Tables"]["doctors"]["Row"];

export type ProvisionDoctorResult = {
  doctor: ProvisionedDoctor;
  authUserId: string;
};

/**
 * The create saga: generateLink(invite) -> insert doctors/clinics/
 * appointment_types/working_hours -> audit_log (outcome only, never the
 * raw link) -> send the invite email immediately, in this same request
 * (PROJECT_SPEC.md's M10 section — invite links are transient, never
 * persisted, and must not wait on the once-daily email_outbox worker).
 *
 * No wrapping SQL function: this is low-frequency, human-supervised,
 * single-trusted-actor work (unlike book_appointment's high-frequency/
 * adversarial-input/concurrency-race context), so atomicity is a
 * TypeScript-level compensating rollback instead. Either everything
 * below committed, or nothing did — deleting the doctors row (which
 * cascades cleanly, since nothing has been booked yet under a
 * just-created doctor) plus the orphaned auth user leaves no partial
 * state to recover from.
 */
export async function provisionDoctor(
  supabase: SupabaseClient<Database>,
  sender: EmailSender,
  input: ProvisionDoctorInput,
): Promise<ProvisionDoctorResult> {
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "invite",
    email: input.email,
    options: { redirectTo: input.redirectTo },
  });

  if (linkError || !linkData.user || !linkData.properties?.action_link) {
    if (linkError?.code === "email_exists" || linkError?.status === 422) {
      throw new AdminError("EMAIL_ALREADY_REGISTERED", "This email is already registered.");
    }
    throw new AdminError("UNKNOWN", linkError?.message ?? "Failed to create the doctor's account.");
  }

  const authUserId = linkData.user.id;
  const actionLink = linkData.properties.action_link;

  // generateLink() does not error for an email that already has a
  // confirmed auth.users account -- verified against local Supabase, it
  // succeeds and returns the existing user rather than raising
  // "email_exists". Without this check, an already-registered doctor's
  // email would reach the insert below, 23505 on doctors_user_id_key, and
  // the catch block's rollback would then delete THAT EXISTING DOCTOR's
  // row and auth account -- not anything this call created. Checking
  // first, before any write, avoids that entirely.
  const { data: existingDoctor } = await supabase
    .from("doctors")
    .select("id")
    .eq("user_id", authUserId)
    .maybeSingle();
  if (existingDoctor) {
    throw new AdminError("EMAIL_ALREADY_REGISTERED", "This email is already registered.");
  }

  let uploadedPhotoPath: string | null = null;

  try {
    const { data: doctor, error: doctorError } = await supabase
      .from("doctors")
      .insert({
        user_id: authUserId,
        specialty_id: input.specialtyId,
        full_name: input.fullName,
        bio: input.bio ?? null,
        phone: input.phone ?? null,
        slug: input.slug,
        default_locale: input.defaultLocale,
        timezone: input.timezone,
        page_variant: input.pageVariant,
        custom_template_key: input.customTemplateKey ?? null,
        is_published: false,
      })
      .select()
      .single();
    if (doctorError) {
      if (doctorError.code === "23505") {
        // generateLink() does not error for an email that already has a
        // confirmed auth.users account (verified against local Supabase —
        // it succeeds and returns the existing user instead of raising
        // "email_exists"). For an email already linked to a doctor, that
        // means this insert is the point where the collision actually
        // surfaces, on doctors_user_id_key rather than doctors_slug_key.
        if (doctorError.message.includes("user_id")) {
          throw new AdminError("EMAIL_ALREADY_REGISTERED", "This email is already registered.");
        }
        throw new AdminError("SLUG_TAKEN", "This URL slug is already in use.");
      }
      throw new AdminError("UNKNOWN", doctorError.message);
    }
    if (input.photo) {
      const photoPath =
        `${doctor.id}/${randomUUID()}.${input.photo.extension}`;

      const { error: uploadError } = await supabase.storage
        .from("doctor-photos")
        .upload(photoPath, input.photo.body, {
          contentType: input.photo.contentType,
          cacheControl: "31536000",
          upsert: false,
        });

      if (uploadError) {
        throw new AdminError("UNKNOWN", uploadError.message);
      }

      uploadedPhotoPath = photoPath;

      const { error: photoUpdateError } = await supabase
        .from("doctors")
        .update({ photo_path: photoPath })
        .eq("id", doctor.id);

      if (photoUpdateError) {
        throw new AdminError("UNKNOWN", photoUpdateError.message);
      }

      doctor.photo_path = photoPath;
    }

    const { data: clinic, error: clinicError } = await supabase
      .from("clinics")
      .insert({ doctor_id: doctor.id, ...input.clinic })
      .select()
      .single();
    if (clinicError) throw new AdminError("UNKNOWN", clinicError.message);

    const { error: typeError } = await supabase
      .from("appointment_types")
      .insert({ doctor_id: doctor.id, name: input.appointmentType.name, duration_minutes: input.appointmentType.durationMinutes });
    if (typeError) throw new AdminError("UNKNOWN", typeError.message);

    if (input.workingDays.length > 0) {
      const { error: hoursError } = await supabase.from("working_hours").insert(
        input.workingDays.map((dayOfWeek) => ({
          doctor_id: doctor.id,
          clinic_id: clinic.id,
          day_of_week: dayOfWeek,
          start_time: input.workingStartTime,
          end_time: input.workingEndTime,
        })),
      );
      if (hoursError) throw new AdminError("UNKNOWN", hoursError.message);
    }

    const { error: auditError } = await supabase.from("audit_log").insert({
      actor_user_id: input.adminActorUserId,
      action: "admin_create_doctor",
      entity_table: "doctors",
      entity_id: doctor.id,
      // Outcome/metadata only — the raw action link never appears here.
      details: { email: input.email },
    });
    if (auditError) throw new AdminError("UNKNOWN", auditError.message);

    const sendResult = await sendAccountEmail(sender, {
      template: "doctor_invite",
      locale: input.defaultLocale,
      to: input.email,
      actionLink,
    });
    if (!sendResult.success) {
      throw new AdminError("EMAIL_SEND_FAILED", sendResult.error);
    }

    return { doctor, authUserId };
  } catch (error) {
    if (uploadedPhotoPath) {
       await supabase.storage
        .from("doctor-photos")
        .remove([uploadedPhotoPath]);
    }
    await supabase.from("doctors").delete().eq("user_id", authUserId);
    await supabase.auth.admin.deleteUser(authUserId).catch(() => undefined);
    throw error;
  }
}
