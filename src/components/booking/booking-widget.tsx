"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SlotPicker } from "./slot-picker";
import { BookingConfirmation } from "./booking-confirmation";
import {
  getSlotsAction,
  submitBookingAction,
  type SubmitBookingResult,
} from "@/app/[locale]/(public)/doctors/[slug]/actions";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import type { BookingInput } from "@/lib/booking/booking-schema";

type Clinic = { id: string; name: string; address: string; timezone: string };
type AppointmentType = { id: string; name: string; durationMinutes: number };
type SuccessResult = Extract<SubmitBookingResult, { success: true }>;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BookingWidget({
  doctorId,
  doctorName,
  clinics,
  appointmentTypes,
  locale,
}: {
  doctorId: string;
  doctorName: string;
  clinics: Clinic[];
  appointmentTypes: AppointmentType[];
  locale: string;
}) {
  const t = useTranslations("booking");

  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? "");
  const [appointmentTypeId, setAppointmentTypeId] = useState(appointmentTypes[0]?.id ?? "");
  const [date, setDate] = useState(todayIsoDate());
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, startSlotsTransition] = useTransition();
  const [rawSelectedSlotStart, setRawSelectedSlotStart] = useState<string | null>(null);
  // Derived rather than imperatively cleared: a previously-clicked slot
  // stops counting as "selected" the moment it's no longer in the current
  // `slots` list — after a date/clinic/type change, or after the server
  // rejects it and refreshSlots() drops it from the list. No effect needs
  // to reset state for this to work.
  const selectedSlotStart =
    rawSelectedSlotStart !== null && slots.some((slot) => slot.slotStart === rawSelectedSlotStart)
      ? rawSelectedSlotStart
      : null;

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof BookingInput, string[]>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<SuccessResult | null>(null);

  const selectedClinic = clinics.find((clinic) => clinic.id === clinicId);

  // startTransition (React 19 async actions) rather than a plain async
  // useCallback + manual loading state: state updates inside a transition
  // are handled by React's own scheduling instead of being a synchronous
  // setState reachable from the effect body, which is what
  // react-hooks/set-state-in-effect is guarding against.
  const refreshSlots = useCallback(() => {
    startSlotsTransition(async () => {
      if (!clinicId || !appointmentTypeId || !date) {
        setSlots([]);
        return;
      }
      const result = await getSlotsAction({ doctorId, clinicId, appointmentTypeId, localDate: date });
      setSlots(result.success ? result.slots : []);
    });
  }, [doctorId, clinicId, appointmentTypeId, date]);

  useEffect(() => {
    refreshSlots();
  }, [refreshSlots]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlotStart || !selectedClinic) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    const result = await submitBookingAction({
      doctorId,
      clinicId,
      appointmentTypeId,
      startsAt: selectedSlotStart,
      patientName: fullName,
      patientPhone: phone,
      patientEmail: email,
    });

    setSubmitting(false);

    if (result.success) {
      setConfirmation(result);
      return;
    }

    if (result.errorCode === "VALIDATION_ERROR") {
      setFieldErrors(result.fieldErrors ?? {});
      setSubmitError(t("errorValidation"));
      return;
    }

    if (result.errorCode === "SLOT_UNAVAILABLE" || result.errorCode === "SCHEDULE_CHANGED") {
      setSubmitError(
        result.errorCode === "SLOT_UNAVAILABLE" ? t("errorSlotUnavailable") : t("errorScheduleChanged"),
      );
      refreshSlots();
      return;
    }

    setSubmitError(t("errorUnknown"));
  }

  if (confirmation && selectedClinic) {
    return (
      <BookingConfirmation
        startsAt={confirmation.appointment.starts_at}
        doctorName={doctorName}
        clinicName={selectedClinic.name}
        clinicAddress={selectedClinic.address}
        clinicTimezone={selectedClinic.timezone}
        patientName={confirmation.appointment.patient_name}
        managementToken={confirmation.managementToken}
        locale={locale}
        labels={{
          confirmationTitle: t("confirmationTitle"),
          confirmationSummaryIntro: t("confirmationSummaryIntro"),
          confirmationDoctorLabel: t("confirmationDoctorLabel"),
          confirmationDateLabel: t("confirmationDateLabel"),
          confirmationClinicLabel: t("confirmationClinicLabel"),
          confirmationPatientLabel: t("confirmationPatientLabel"),
          managementLinkTitle: t("managementLinkTitle"),
          managementLinkDescription: t("managementLinkDescription"),
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {clinics.length > 1 ? (
          <div>
            <Label htmlFor="booking-clinic">{t("clinicLabel")}</Label>
            <select
              id="booking-clinic"
              value={clinicId}
              onChange={(event) => setClinicId(event.target.value)}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 mt-1.5 h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3"
            >
              {clinics.map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {appointmentTypes.length > 1 ? (
          <div>
            <Label htmlFor="booking-type">{t("appointmentTypeLabel")}</Label>
            <select
              id="booking-type"
              value={appointmentTypeId}
              onChange={(event) => setAppointmentTypeId(event.target.value)}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 mt-1.5 h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3"
            >
              {appointmentTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {selectedClinic ? (
          <SlotPicker
            date={date}
            onDateChange={setDate}
            minDate={todayIsoDate()}
            slots={slots}
            selectedSlotStart={selectedSlotStart}
            onSelectSlot={setRawSelectedSlotStart}
            clinicTimezone={selectedClinic.timezone}
            locale={locale}
            loading={slotsLoading}
            dateLabel={t("dateLabel")}
            loadingLabel={t("slotsLoading")}
            emptyLabel={t("slotsEmpty")}
          />
        ) : null}

        {/* Rendered outside the slot-dependent form on purpose: a conflict
            error (slot taken / schedule changed) clears the selection as
            part of showing it, so nesting this inside the
            `selectedSlotStart` block would hide the message at the exact
            moment the user needs to read it. */}
        {submitError ? <p className="text-destructive text-sm">{submitError}</p> : null}

        {selectedSlotStart ? (
          <form onSubmit={handleSubmit} className="space-y-4 border-t pt-5">
            <div>
              <Label htmlFor="patient-name">{t("fullNameLabel")}</Label>
              <Input
                id="patient-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1.5"
                required
              />
              {fieldErrors.patientName ? (
                <p className="text-destructive mt-1 text-xs">{fieldErrors.patientName[0]}</p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="patient-phone">{t("phoneLabel")}</Label>
              <Input
                id="patient-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="mt-1.5"
                required
              />
              {fieldErrors.patientPhone ? (
                <p className="text-destructive mt-1 text-xs">{fieldErrors.patientPhone[0]}</p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="patient-email">{t("emailLabel")}</Label>
              <Input
                id="patient-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5"
                required
              />
              {fieldErrors.patientEmail ? (
                <p className="text-destructive mt-1 text-xs">{fieldErrors.patientEmail[0]}</p>
              ) : null}
            </div>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? t("submitting") : t("submitAction")}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
