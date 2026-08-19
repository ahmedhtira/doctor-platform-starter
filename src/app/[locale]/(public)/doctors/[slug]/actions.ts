"use server";

import { after } from "next/server";
import { createResendSender } from "@/lib/email/resend-sender";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getAvailableSlots } from "@/lib/availability/get-available-slots";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import { bookingSchema, type BookingInput } from "@/lib/booking/booking-schema";
import { bookAppointment, type BookedAppointment } from "@/lib/booking/book-appointment";
import { BookingError, type BookingErrorCode } from "@/lib/booking/booking-errors";

// Server Actions — the only place client code touches the availability
// engine or book_appointment. Both use the service-role client
// (createServiceRoleClient / getAvailableSlots's own internal one); the
// booking widget never talks to Supabase directly.

const PRIVACY_POLICY_VERSION = "2026-08-19";
const BOOKING_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

const getSlotsInputSchema = z.object({
  doctorId: z.uuid(),
  clinicId: z.uuid(),
  appointmentTypeId: z.uuid(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const publicBookingSchema = bookingSchema.and(
  z.object({
    privacyConsent: z.literal(true),
    adultConfirmation: z.literal(true),
  }),
);

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
    return { success: false, message: "Unable to load available slots." };
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
  const parsed = publicBookingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errorCode: "VALIDATION_ERROR",
      message: "Some fields are invalid.",
      fieldErrors: parsed.error.flatten().fieldErrors as Partial<
        Record<keyof BookingInput, string[]>
      >,
    };
  }

  const supabase = createServiceRoleClient();

  try {
    const { privacyConsent, adultConfirmation, ...bookingInput } = parsed.data;
    const [globalAllowed, doctorAllowed] = await Promise.all([
      consumeRateLimit(supabase, {
        scope: "public-booking-global",
        limit: 30,
        windowSeconds: BOOKING_RATE_LIMIT_WINDOW_SECONDS,
      }),
      consumeRateLimit(supabase, {
        scope: "public-booking-doctor",
        discriminator: bookingInput.doctorId,
        limit: 10,
        windowSeconds: BOOKING_RATE_LIMIT_WINDOW_SECONDS,
      }),
    ]);

    if (!globalAllowed || !doctorAllowed) {
      return {
        success: false,
        errorCode: "UNKNOWN",
        message: "Unable to complete the booking. Please try again later.",
      };
    }

    const result = await bookAppointment(supabase, bookingInput, {
      privacyConsent,
      adultConfirmation,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    });

    after(async () => {
      try {
        await processEmailOutbox(createServiceRoleClient(), createResendSender(), { limit: 20 });
      } catch (error) {
        console.error("submitBookingAction: email outbox processing failed", error);
      }
    });

    return {
      success: true,
      appointment: result.appointment,
      managementToken: result.managementToken,
    };
  } catch (error) {
    if (error instanceof BookingError) {
      return {
        success: false,
        errorCode: error.code,
        message: "Unable to complete the booking. Please try again.",
      };
    }
    console.error("submitBookingAction: unexpected error", error);
    return {
      success: false,
      errorCode: "UNKNOWN",
      message: "Unable to complete the booking. Please try again.",
    };
  }
}
