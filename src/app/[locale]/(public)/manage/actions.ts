"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAvailableSlots } from "@/lib/availability/get-available-slots";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import { managementTokenPattern } from "@/lib/booking/generate-management-token";
import { hashSecret } from "@/lib/booking/crypto-secret";
import { redeemManagementToken } from "@/lib/booking/redeem-management-token";
import { getManagedAppointment } from "@/lib/booking/get-managed-appointment";
import { cancelManagedAppointment } from "@/lib/booking/cancel-managed-appointment";
import { rescheduleManagedAppointment } from "@/lib/booking/reschedule-managed-appointment";
import { ManageError, type ManageActionErrorCode } from "@/lib/booking/manage-errors";
import {
  MANAGE_SESSION_COOKIE_NAME,
  manageSessionCookieOptions,
} from "@/lib/booking/manage-session-cookie";
import type { BookedAppointment } from "@/lib/booking/book-appointment";

// Server Actions — the only place client code touches the management
// session, cancel_appointment, or reschedule_appointment. Mirrors
// doctors/[slug]/actions.ts: Zod-validated `unknown` input, a service-role
// client constructed here, discriminated-union results, raw Postgres
// errors never forwarded to the client.
//
// Every action past redemption reads the *hash* of the manage-session
// cookie's raw secret and threads that hash through — never the raw
// secret itself, and never appointment_management_sessions.id. See
// manage-session-cookie.ts for why.

async function readManagementSessionSecretHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const rawSecret = cookieStore.get(MANAGE_SESSION_COOKIE_NAME)?.value;
  if (!rawSecret) {
    return null;
  }
  return hashSecret(rawSecret);
}

const redeemInputSchema = z.object({
  rawToken: z.string().regex(managementTokenPattern),
});

export type RedeemManagementTokenResult =
  | { success: true }
  | {
      success: false;
      errorCode: "INVALID_OR_EXPIRED_TOKEN" | "VALIDATION_ERROR" | "UNKNOWN";
      message: string;
    };

export async function redeemManagementTokenAction(
  rawToken: unknown,
): Promise<RedeemManagementTokenResult> {
  const parsed = redeemInputSchema.safeParse({ rawToken });
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid link." };
  }

  const supabase = createServiceRoleClient();

  try {
    const { session, sessionSecret } = await redeemManagementToken(supabase, parsed.data.rawToken);
    const maxAgeSeconds = Math.max(
      0,
      Math.floor((new Date(session.expires_at).getTime() - Date.now()) / 1000),
    );

    const cookieStore = await cookies();
    cookieStore.set(
      MANAGE_SESSION_COOKIE_NAME,
      sessionSecret,
      manageSessionCookieOptions(maxAgeSeconds),
    );

    return { success: true };
  } catch (error) {
    if (error instanceof ManageError) {
      return { success: false, errorCode: "INVALID_OR_EXPIRED_TOKEN", message: error.message };
    }
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

export type CancelManagedAppointmentResult =
  { success: true } | { success: false; errorCode: ManageActionErrorCode; message: string };

export async function cancelManagedAppointmentAction(): Promise<CancelManagedAppointmentResult> {
  const secretHash = await readManagementSessionSecretHash();
  if (!secretHash) {
    return {
      success: false,
      errorCode: "SESSION_INVALID",
      message: "No active management session.",
    };
  }

  const supabase = createServiceRoleClient();

  try {
    await cancelManagedAppointment(supabase, secretHash);
    return { success: true };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as ManageActionErrorCode,
        message: error.message,
      };
    }
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

const rescheduleInputSchema = z.object({
  newStartsAt: z.iso.datetime({ offset: true }),
});

export type RescheduleManagedAppointmentResult =
  | { success: true; appointment: BookedAppointment; managementToken: string }
  | { success: false; errorCode: ManageActionErrorCode | "VALIDATION_ERROR"; message: string };

export async function rescheduleManagedAppointmentAction(
  newStartsAt: unknown,
): Promise<RescheduleManagedAppointmentResult> {
  const parsed = rescheduleInputSchema.safeParse({ newStartsAt });
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const secretHash = await readManagementSessionSecretHash();
  if (!secretHash) {
    return {
      success: false,
      errorCode: "SESSION_INVALID",
      message: "No active management session.",
    };
  }

  const supabase = createServiceRoleClient();

  try {
    const result = await rescheduleManagedAppointment(supabase, {
      managementSessionSecretHash: secretHash,
      newStartsAt: parsed.data.newStartsAt,
    });
    return {
      success: true,
      appointment: result.appointment,
      managementToken: result.managementToken,
    };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as ManageActionErrorCode,
        message: error.message,
      };
    }
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

const getManageSlotsInputSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type GetManageSlotsResult =
  { success: true; slots: AvailableSlot[] } | { success: false; message: string };

export async function getManageSlotsAction(localDate: unknown): Promise<GetManageSlotsResult> {
  const parsed = getManageSlotsInputSchema.safeParse({ localDate });
  if (!parsed.success) {
    return { success: false, message: "Invalid request." };
  }

  const secretHash = await readManagementSessionSecretHash();
  if (!secretHash) {
    return { success: false, message: "No active management session." };
  }

  const supabase = createServiceRoleClient();

  try {
    // Never trust client-supplied doctor/clinic/appointment-type ids here —
    // unlike booking's getSlotsAction, this path has a session to anchor
    // to, so it always resolves them itself.
    const view = await getManagedAppointment(supabase, secretHash);
    if (!view) {
      return { success: false, message: "No active management session." };
    }

    const slots = await getAvailableSlots({
      doctorId: view.doctorId,
      clinicId: view.clinicId,
      appointmentTypeId: view.appointmentTypeId,
      localDate: parsed.data.localDate,
      now: new Date().toISOString(),
    });
    return { success: true, slots };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Unknown error." };
  }
}
