"use server";

import { after } from "next/server";
import { createResendSender } from "@/lib/email/resend-sender";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAvailableSlots } from "@/lib/availability/get-available-slots";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import { bookingSchema, type BookingInput } from "@/lib/booking/booking-schema";
import { bookAppointment, type BookedAppointment } from "@/lib/booking/book-appointment";
import { BookingError, type BookingErrorCode } from "@/lib/booking/booking-errors";

// Server Actions — the only place client code touches the availability
// engine or book_appointment. Both use the service-role client
// (createServiceRoleClient / getAvailableSlots's own internal one); the
// booking widget never talks to Supabase directly.

const getSlotsInputSchema = z.object({
  doctorId: z.uuid(),
  clinicId: z.uuid(),
  appointmentTypeId: z.uuid(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type GetSlotsResult = { success: true; slots: AvailableSlot[] } | { success: false; message: string };

export async function getSlotsAction(input: unknown): Promise<GetSlotsResult> {
  const parsed = getSlotsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid request." };
  }

  try {
    const slots = await getAvailableSlots({
      doctorId: parsed.data.doctorId,
      clinicId: parsed.data.clinicId,
      appointmentTypeId: parsed.data.appointmentTypeId,
      localDate: parsed.data.localDate,
      now: new Date().toISOString(),
    });
    return { success: true, slots };
  } catch (error) {
    console.error("getSlotsAction: unexpected error", error);
    return { success: false, message: error instanceof Error ? error.message : "Unknown error." };
  }
}

export type SubmitBookingResult =
  | { success: true; appointment: BookedAppointment; managementToken: string }
  | {
      success: false;
      errorCode: BookingErrorCode | "VALIDATION_ERROR";
      message: string;
      fieldErrors?: Partial<Record<keyof BookingInput, string[]>>;
    };

export async function submitBookingAction(input: unknown): Promise<SubmitBookingResult> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errorCode: "VALIDATION_ERROR",
      message: "Some fields are invalid.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = createServiceRoleClient();

  try {
    const result = await bookAppointment(supabase, parsed.data);

after(async () => {
  try {
    await processEmailOutbox(
      createServiceRoleClient(),
      createResendSender(),
      { limit: 20 },
    );
  } catch (error) {
    console.error(
      "submitBookingAction: email outbox processing failed",
      error,
    );
  }
});

return {
  success: true,
  appointment: result.appointment,
  managementToken: result.managementToken,
}; catch (error) {
    if (error instanceof BookingError) {
      return { success: false, errorCode: error.code, message: error.message };
    }
    console.error("submitBookingAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}
