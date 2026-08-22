"use server";

import { after } from "next/server";
import { createResendSender } from "@/lib/email/resend-sender";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";
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
import {
  applyStaffAppointmentDelay,
  createStaffAppointment,
  previewStaffAppointmentDelay,
  type StaffCreatedAppointment,
  type StaffDelayPlan,
} from "@/lib/dashboard/staff-schedule-actions";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import type { StaffCancelledAppointment } from "@/lib/dashboard/cancel-staff-appointment";
import type { StaffRescheduledAppointment } from "@/lib/dashboard/reschedule-staff-appointment";
import { ManageError, type ManageActionErrorCode } from "@/lib/booking/manage-errors";

// Server Actions — the only place client code touches privileged appointment
// RPCs. Every action re-resolves actorUserId from Supabase Auth server-side;
// it never accepts the authenticated actor id from the browser.
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

function processOutboxAfterResponse(context: string) {
  after(async () => {
    try {
      await processEmailOutbox(createServiceRoleClient(), createResendSender(), { limit: 20 });
    } catch (error) {
      console.error(`${context}: email outbox processing failed`, error);
    }
  });
}

const createStaffAppointmentInputSchema = z.object({
  doctorId: z.uuid(),
  clinicId: z.uuid(),
  appointmentTypeId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  patientName: z.string().trim().min(1).max(120),
  patientPhone: z.string().trim().min(3).max(40),
  patientEmail: z.string().trim().email().max(254).nullable(),
  notes: z.string().trim().max(1000).nullable(),
});

export type CreateStaffAppointmentResult =
  | { success: true; appointment: StaffCreatedAppointment }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function createStaffAppointmentAction(
  input: unknown,
): Promise<CreateStaffAppointmentResult> {
  const parsed = createStaffAppointmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  try {
    const appointment = await createStaffAppointment(createServiceRoleClient(), {
      ...parsed.data,
      actorUserId: actor.actorUserId,
    });
    processOutboxAfterResponse("createStaffAppointmentAction");
    return { success: true, appointment };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as ActionErrorCode,
        message: "Unable to create appointment.",
      };
    }
    console.error("createStaffAppointmentAction: unexpected error", error);
    return { success: false, errorCode: "UNKNOWN", message: "Unable to create appointment." };
  }
}

const delayInputSchema = z.object({
  appointmentId: z.uuid(),
  delayMinutes: z.number().int().min(1).max(240),
});

export type PreviewStaffDelayResult =
  | { success: true; plan: StaffDelayPlan }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function previewStaffAppointmentDelayAction(
  input: unknown,
): Promise<PreviewStaffDelayResult> {
  const parsed = delayInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  try {
    const plan = await previewStaffAppointmentDelay(createServiceRoleClient(), {
      ...parsed.data,
      actorUserId: actor.actorUserId,
    });
    return { success: true, plan };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as ActionErrorCode,
        message: "Unable to preview delay.",
      };
    }
    console.error("previewStaffAppointmentDelayAction: unexpected error", error);
    return { success: false, errorCode: "UNKNOWN", message: "Unable to preview delay." };
  }
}

export type ApplyStaffDelayResult =
  | { success: true; plan: StaffDelayPlan }
  | { success: false; errorCode: ActionErrorCode; message: string };

export async function applyStaffAppointmentDelayAction(
  input: unknown,
): Promise<ApplyStaffDelayResult> {
  const parsed = delayInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const actor = await requireActorUserId();
  if (!actor.success) {
    return { success: false, errorCode: actor.errorCode, message: "Not authenticated." };
  }

  try {
    const plan = await applyStaffAppointmentDelay(createServiceRoleClient(), {
      ...parsed.data,
      actorUserId: actor.actorUserId,
    });
    processOutboxAfterResponse("applyStaffAppointmentDelayAction");
    return { success: true, plan };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as ActionErrorCode,
        message: "Unable to apply delay.",
      };
    }
    console.error("applyStaffAppointmentDelayAction: unexpected error", error);
    return { success: false, errorCode: "UNKNOWN", message: "Unable to apply delay." };
  }
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
    processOutboxAfterResponse("cancelAppointmentAction");
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
  | { success: true; slots: AvailableSlot[] }
  | { success: false; message: string };

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
    processOutboxAfterResponse("rescheduleAppointmentAction");
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
