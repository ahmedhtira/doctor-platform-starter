"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createResendSender } from "@/lib/email/resend-sender";
import { getAuthenticatedUser } from "@/lib/dashboard/auth-context";
import { getPlatformAdminUserId } from "@/lib/admin/env";
import { isPlatformAdminUserId } from "@/lib/admin/is-platform-admin";
import { AdminError, type AdminErrorCode } from "@/lib/admin/admin-errors";
import {
  provisionDoctor,
  type ProvisionedDoctor,
  type ProvisionDoctorPhoto,
} from "@/lib/admin/provision-doctor";
import { updateDoctor, type UpdatedDoctor } from "@/lib/admin/update-doctor";
import { setDoctorPublished } from "@/lib/admin/set-doctor-published";
import { setDoctorSuspended } from "@/lib/admin/set-doctor-suspended";
import { deleteDoctor, type DeleteDoctorResult } from "@/lib/admin/delete-doctor";
import { getAppUrl } from "@/lib/email/env";

// Server Actions — the only place client code touches admin doctor
// management. Each independently re-resolves the actor server-side and
// re-checks PLATFORM_ADMIN_USER_ID; never trusts the caller (a Server
// Action is a public endpoint in its own right, same discipline
// dashboard/actions.ts already established). Deliberately does NOT reuse
// requirePlatformAdmin() (which redirects) — a redirect thrown from
// inside a client-invoked mutation is awkward, same reason
// dashboard/actions.ts's requireActorUserId() returns a discriminated
// result instead of redirecting.

type ActionErrorCode = AdminErrorCode | "UNAUTHENTICATED";

async function requireAdminActorUserId(): Promise<
  { success: true; actorUserId: string } | { success: false; errorCode: "UNAUTHENTICATED" }
> {
  const user = await getAuthenticatedUser();
  if (!user || !isPlatformAdminUserId(user.id, getPlatformAdminUserId())) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }
  return { success: true, actorUserId: user.id };
}
const MAX_DOCTOR_PHOTO_BYTES = 2 * 1024 * 1024;

function detectDoctorPhotoType(
  bytes: Uint8Array,
): Pick<ProvisionDoctorPhoto, "contentType" | "extension"> | null {
  // JPEG
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }

  // WebP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }

  return null;
}

async function parseDoctorPhoto(
  formData: FormData,
): Promise<ProvisionDoctorPhoto | undefined> {
  const entry = formData.get("photo");

  if (!(entry instanceof File) || entry.size === 0) {
    return undefined;
  }

  if (entry.size > MAX_DOCTOR_PHOTO_BYTES) {
    throw new AdminError(
      "VALIDATION_ERROR",
      "Doctor photo must be 2 MB or smaller.",
    );
  }

  const body = await entry.arrayBuffer();
  const detected = detectDoctorPhotoType(new Uint8Array(body));

  if (!detected) {
    throw new AdminError(
      "VALIDATION_ERROR",
      "Doctor photo must be JPEG, PNG, or WebP.",
    );
  }

  return {
    body,
    ...detected,
  };
}

const consultationLocationTypeSchema = z.enum([
  "private_practice",
  "clinic",
  "hospital",
  "medical_center",
  "other",
]);

const clinicInputSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  locationType: consultationLocationTypeSchema.default("other"),
});

const createDoctorInputSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(1),
  specialtyId: z.uuid(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  defaultLocale: z.enum(["fr", "ar"]),
  bio: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  pageVariant: z.enum(["standard", "custom"]),
  customTemplateKey: z.string().trim().optional(),
  clinic: clinicInputSchema,
  appointmentTypeName: z.string().trim().min(1),
  appointmentTypeDurationMinutes: z.coerce.number().int().min(5).max(480),
  workingDays: z.array(z.coerce.number().int().min(0).max(6)),
  workingStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  workingEndTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export type CreateDoctorResult =
  | { success: true; doctor: ProvisionedDoctor }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function createDoctorAction(
  input: unknown,
): Promise<CreateDoctorResult> {
  let rawInput = input;
  let photo: ProvisionDoctorPhoto | undefined;

  try {
    if (input instanceof FormData) {
      const payload = input.get("payload");

      if (typeof payload !== "string") {
        return {
          success: false,
          errorCode: "VALIDATION_ERROR",
          message: "Invalid request.",
        };
      }

      rawInput = JSON.parse(payload);
      photo = await parseDoctorPhoto(input);
    }
  } catch (error) {
    if (error instanceof AdminError) {
      return {
        success: false,
        errorCode: error.code,
        message: error.message,
      };
    }

    return {
      success: false,
      errorCode: "VALIDATION_ERROR",
      message: "Invalid request.",
    };
  }

  const parsed = createDoctorInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireAdminActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  const supabase = createServiceRoleClient();
  const locale = await getLocale();

  try {
    const result = await provisionDoctor(supabase, createResendSender(), {
      adminActorUserId: actor.actorUserId,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      specialtyId: parsed.data.specialtyId,
      slug: parsed.data.slug,
      defaultLocale: parsed.data.defaultLocale,
      timezone: "Africa/Tunis",
      bio: parsed.data.bio,
      phone: parsed.data.phone,
      photo,
      pageVariant: parsed.data.pageVariant,
      customTemplateKey: parsed.data.customTemplateKey,
      clinic: {
  name: parsed.data.clinic.name,
  address: parsed.data.clinic.address,
  city: parsed.data.clinic.city,
  location_type: parsed.data.clinic.locationType,
  timezone: "Africa/Tunis",
},
      appointmentType: {
        name: parsed.data.appointmentTypeName,
        durationMinutes: parsed.data.appointmentTypeDurationMinutes,
      },
      workingDays: parsed.data.workingDays,
      workingStartTime: parsed.data.workingStartTime,
      workingEndTime: parsed.data.workingEndTime,
      redirectTo: `${getAppUrl()}/${locale}/auth/confirm`,
    });
    return { success: true, doctor: result.doctor };
  } catch (error) {
    if (error instanceof AdminError) {
      return { success: false, errorCode: error.code, message: error.message };
    }
    console.error("createDoctorAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

const updateDoctorInputSchema = z.object({
  doctorId: z.uuid(),
  fullName: z.string().trim().min(1),
  specialtyId: z.uuid(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  defaultLocale: z.enum(["fr", "ar"]),
  timezone: z.string().trim().min(1),
  minBookingNoticeMinutes: z.coerce.number().int().min(0),
  bio: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  pageVariant: z.enum(["standard", "custom"]),
  customTemplateKey: z.string().trim().optional(),
});

export type UpdateDoctorResult =
  | { success: true; doctor: UpdatedDoctor }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function updateDoctorAction(input: unknown): Promise<UpdateDoctorResult> {
  const parsed = updateDoctorInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireAdminActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  const supabase = createServiceRoleClient();

  try {
    const doctor = await updateDoctor(supabase, {
      doctorId: parsed.data.doctorId,
      fullName: parsed.data.fullName,
      specialtyId: parsed.data.specialtyId,
      slug: parsed.data.slug,
      defaultLocale: parsed.data.defaultLocale,
      timezone: parsed.data.timezone,
      minBookingNoticeMinutes: parsed.data.minBookingNoticeMinutes,
      bio: parsed.data.bio,
      phone: parsed.data.phone,
      pageVariant: parsed.data.pageVariant,
      customTemplateKey: parsed.data.customTemplateKey,
    });
    return { success: true, doctor };
  } catch (error) {
    if (error instanceof AdminError) {
      return { success: false, errorCode: error.code, message: error.message };
    }
    console.error("updateDoctorAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

const doctorIdInputSchema = z.object({ doctorId: z.uuid() });

export type SimpleAdminResult =
  | { success: true }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function setDoctorPublishedAction(input: unknown): Promise<SimpleAdminResult> {
  const parsed = z.object({ doctorId: z.uuid(), isPublished: z.boolean() }).safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }
  const actor = await requireAdminActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }
  try {
    await setDoctorPublished(createServiceRoleClient(), parsed.data);
    return { success: true };
  } catch (error) {
    if (error instanceof AdminError) {
      return { success: false, errorCode: error.code, message: error.message };
    }
    console.error("setDoctorPublishedAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

export async function setDoctorSuspendedAction(input: unknown): Promise<SimpleAdminResult> {
  const parsed = z.object({ doctorId: z.uuid(), suspended: z.boolean() }).safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }
  const actor = await requireAdminActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }
  try {
    await setDoctorSuspended(createServiceRoleClient(), parsed.data);
    return { success: true };
  } catch (error) {
    if (error instanceof AdminError) {
      return { success: false, errorCode: error.code, message: error.message };
    }
    console.error("setDoctorSuspendedAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

export type DeleteDoctorActionResult =
  | { success: true; result: DeleteDoctorResult }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function deleteDoctorAction(input: unknown): Promise<DeleteDoctorActionResult> {
  const parsed = doctorIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }
  const actor = await requireAdminActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }
  try {
    const result = await deleteDoctor(createServiceRoleClient(), parsed.data);
    return { success: true, result };
  } catch (error) {
    if (error instanceof AdminError) {
      return { success: false, errorCode: error.code, message: error.message };
    }
    console.error("deleteDoctorAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}
