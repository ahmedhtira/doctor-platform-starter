"use server";

import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/dashboard/auth-context";
import { getStaffManualAppointmentSlots } from "@/lib/dashboard/get-staff-manual-appointment-slots";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ManageError, type ManageActionErrorCode } from "@/lib/booking/manage-errors";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";

type ManualSlotsErrorCode = ManageActionErrorCode | "UNAUTHENTICATED" | "VALIDATION_ERROR";

const inputSchema = z.object({
  doctorId: z.uuid(),
  clinicId: z.uuid(),
  appointmentTypeId: z.uuid(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type GetStaffManualAppointmentSlotsResult =
  | { success: true; slots: AvailableSlot[] }
  | { success: false; errorCode: ManualSlotsErrorCode; message: string };

export async function getStaffManualAppointmentSlotsAction(
  input: unknown,
): Promise<GetStaffManualAppointmentSlotsResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, errorCode: "UNAUTHENTICATED", message: "Not authenticated." };
  }

  try {
    const slots = await getStaffManualAppointmentSlots(createServiceRoleClient(), {
      ...parsed.data,
      actorUserId: user.id,
      now: new Date().toISOString(),
    });
    return { success: true, slots };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as ManualSlotsErrorCode,
        message: "Unable to load available times.",
      };
    }
    console.error("getStaffManualAppointmentSlotsAction: unexpected error", error);
    return { success: false, errorCode: "UNKNOWN", message: "Unable to load available times." };
  }
}
