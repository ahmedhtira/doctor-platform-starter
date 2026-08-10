"use server";

import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAuthenticatedUser } from "@/lib/dashboard/auth-context";
import { cancelStaffAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import {
  getStaffRescheduleSlots,
  rescheduleStaffAppointment,
} from "@/lib/dashboard/reschedule-staff-appointment";
import {
  recordStaffAppointmentOutcome,
  type StaffRecordedOutcomeAppointment,
} from "@/lib/dashboard/record-staff-appointment-outcome";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import type { StaffCancelledAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import type { StaffRescheduledAppointment } from "@/lib/dashboard/reschedule-staff-appointment";
import { ManageError, type ManageActionErrorCode } from "@/lib/booking/manage-errors";

// Server Actions — the only place client code touches cancel_appointment/
// reschedule_appointment for the dashboard. Each independently re-resolves
// actorUserId from getAuthenticatedUser() server-side; never accepts it as
// a client-supplied argument (the dashboard layout/page already gated on
// this user being staff, but a Server Action is a public endpoint in its
// own right and must not trust its caller).

type ActionErrorCode = ManageActionErrorCode | "UNAUTHENTICATED" | "VALIDATION_ERROR";

async function requireActorUserId(): Promise<
  { success: true; actorUserId: string } | { success: false; errorCode: "UNAUTHENTICATED" }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, errorCode: "UNAUTHENTICATED" };
  }
  return { success: true, actorUserId: user.id };
}

const cancelInputSchema = z.object({ appointmentId: z.uuid() });

export type CancelAppointmentResult =
  | { success: true; appointment: StaffCancelledAppointment }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function cancelAppointmentAction(input: unknown): Promise<CancelAppointmentResult> {
  const parsed = cancelInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  const supabase = createServiceRoleClient();

  try {
    const appointment = await cancelStaffAppointment(supabase, {
      appointmentId: parsed.data.appointmentId,
      actorUserId: actor.actorUserId,
    });
    return { success: true, appointment };
  } catch (error) {
    if (error instanceof ManageError) {
      return { success: false, errorCode: error.code as ActionErrorCode, message: error.message };
    }
    console.error("cancelAppointmentAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

const recordOutcomeInputSchema = z.object({
  appointmentId: z.uuid(),
  outcome: z.enum(["completed", "no_show"]),
});

export type RecordAppointmentOutcomeResult =
  | { success: true; appointment: StaffRecordedOutcomeAppointment }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function recordAppointmentOutcomeAction(
  input: unknown,
): Promise<RecordAppointmentOutcomeResult> {
  const parsed = recordOutcomeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  const supabase = createServiceRoleClient();

  try {
    const appointment = await recordStaffAppointmentOutcome(supabase, {
      appointmentId: parsed.data.appointmentId,
      actorUserId: actor.actorUserId,
      outcome: parsed.data.outcome,
    });
    return { success: true, appointment };
  } catch (error) {
    if (error instanceof ManageError) {
      return { success: false, errorCode: error.code as ActionErrorCode, message: error.message };
    }
    console.error("recordAppointmentOutcomeAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

const getRescheduleSlotsInputSchema = z.object({
  appointmentId: z.uuid(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type GetStaffRescheduleSlotsResult =
  { success: true; slots: AvailableSlot[] } | { success: false; message: string };

export async function getStaffRescheduleSlotsAction(
  input: unknown,
): Promise<GetStaffRescheduleSlotsResult> {
  const parsed = getRescheduleSlotsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, message: "Not authenticated." };
  }

  const supabase = createServiceRoleClient();

  try {
    const slots = await getStaffRescheduleSlots(supabase, {
      appointmentId: parsed.data.appointmentId,
      localDate: parsed.data.localDate,
    });
    return { success: true, slots };
  } catch (error) {
    console.error("getStaffRescheduleSlotsAction: unexpected error", error);
    return { success: false, message: error instanceof Error ? error.message : "Unknown error." };
  }
}

const rescheduleInputSchema = z.object({
  appointmentId: z.uuid(),
  newStartsAt: z.iso.datetime({ offset: true }),
});

export type RescheduleAppointmentResult =
  | { success: true; appointment: StaffRescheduledAppointment; managementToken: string }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function rescheduleAppointmentAction(
  input: unknown,
): Promise<RescheduleAppointmentResult> {
  const parsed = rescheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  const supabase = createServiceRoleClient();

  try {
    const result = await rescheduleStaffAppointment(supabase, {
      appointmentId: parsed.data.appointmentId,
      actorUserId: actor.actorUserId,
      newStartsAt: parsed.data.newStartsAt,
    });
    return {
      success: true,
      appointment: result.appointment,
      managementToken: result.managementToken,
    };
  } catch (error) {
    if (error instanceof ManageError) {
      return { success: false, errorCode: error.code as ActionErrorCode, message: error.message };
    }
    console.error("rescheduleAppointmentAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}
