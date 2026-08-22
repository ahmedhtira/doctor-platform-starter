"use server";

import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/dashboard/auth-context";
import { updateStaffAppointmentDetails } from "@/lib/dashboard/staff-schedule-actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ManageError, type ManageActionErrorCode } from "@/lib/booking/manage-errors";

const inputSchema = z.object({
  appointmentId: z.uuid(),
  appointmentTypeId: z.uuid(),
  patientName: z.string().trim().min(1).max(120),
  patientPhone: z.string().trim().min(3).max(40),
  patientEmail: z.string().trim().email().max(254).nullable(),
  notes: z.string().trim().max(1000).nullable(),
});

type UpdateErrorCode = ManageActionErrorCode | "UNAUTHENTICATED" | "VALIDATION_ERROR";

export type UpdateStaffAppointmentDetailsResult =
  | { success: true }
  | { success: false; errorCode: UpdateErrorCode; message: string };

export async function updateStaffAppointmentDetailsAction(
  input: unknown,
): Promise<UpdateStaffAppointmentDetailsResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "VALIDATION_ERROR", message: "Invalid request." };
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, errorCode: "UNAUTHENTICATED", message: "Not authenticated." };
  }

  try {
    await updateStaffAppointmentDetails(createServiceRoleClient(), {
      ...parsed.data,
      actorUserId: user.id,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof ManageError) {
      return {
        success: false,
        errorCode: error.code as UpdateErrorCode,
        message: "Unable to update appointment.",
      };
    }
    console.error("updateStaffAppointmentDetailsAction: unexpected error", error);
    return { success: false, errorCode: "UNKNOWN", message: "Unable to update appointment." };
  }
}
