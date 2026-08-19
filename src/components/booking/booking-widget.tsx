"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays, Check, UserRound } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
  const selectedSlotStart =
    rawSelectedSlotStart !== null && slots.some((slot) => slot.slotStart === rawSelectedSlotStart)
      ? rawSelectedSlotStart
      : null;

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [adultConfirmation, setAdultConfirmation] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof BookingInput, string[]>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<SuccessResult | null>(null);

  const selectedClinic = clinics.find((clinic) => clinic.id === clinicId);
  const selectedAppointmentType = appointmentTypes.find(
    (appointmentType) => appointmentType.id === appointmentTypeId,
  );
  const activeStep = selectedSlotStart ? 2 : 1;
  const steps = [
    { number: 1, label: t("steps.chooseSlot"), icon: CalendarDays },
    { number: 2, label: t("steps.yourDetails"), icon: UserRound },
    { number: 3, label: t("steps.confirmation"), icon: Check },
  ];

  const refreshSlots = useCallback(() => {
    startSlotsTransition(async () => {
      if (!clinicId || !appointmentTypeId || !date) {
        setSlots([]);
        return;
      }
      const result = await getSlotsAction({
        doctorId,
        clinicId,
        appointmentTypeId,
        localDate: date,
      });
      setSlots(result.success ? result.slots : []);
    });
  }, [doctorId, clinicId, appointmentTypeId, date]);

  useEffect(() => {
    refreshSlots();
  }, [refreshSlots]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlotStart || !selectedClinic || !privacyConsent || !adultConfirmation) {
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
      privacyConsent,
      adultConfirmation,
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
        result.errorCode === "SLOT_UNAVAILABLE"
          ? t("errorSlotUnavailable")
          : t("errorScheduleChanged"),
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
        durationMinutes={selectedAppointmentType?.durationMinutes ?? 30}
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
          addToCalendarAction: t("addToCalendarAction"),
          nextStepsTitle: t("nextStepsTitle"),
          nextStepsDescription: t("nextStepsDescription"),
          manageAppointmentAction: t("manageAppointmentAction"),
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
        <ol className="grid grid-cols-3 gap-2" aria-label={t("steps.label")}>
          {steps.map(({ number, label, icon: Icon }) => {
            const isActive = number === activeStep;
            const isComplete = number < activeStep;

            return (
              <li key={number} className="min-w-0 text-center">
                <div
                  className={cn(
                    "mx-auto flex size-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                    isActive || isComplete
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {isComplete ? <Check className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                </div>
                <p
                  className={cn(
                    "mt-1.5 truncate text-xs",
                    isActive ? "text-foreground font-semibold" : "text-muted-foreground",
                  )}
                >
                  {label}
                </p>
              </li>
            );
          })}
        </ol>

        <div className="border-t" />

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
                <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
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
                <option key={type.id} value={type.id}>{type.name}</option>
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

        {submitError ? <p className="text-destructive text-sm">{submitError}</p> : null}

        {selectedSlotStart ? (
          <form onSubmit={handleSubmit} className="space-y-4 border-t pt-5">
            <div>
              <Label htmlFor="patient-name">{t("fullNameLabel")}</Label>
              <Input id="patient-name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5" required />
              {fieldErrors.patientName ? <p className="text-destructive mt-1 text-xs">{fieldErrors.patientName[0]}</p> : null}
            </div>

            <div>
              <Label htmlFor="patient-phone">{t("phoneLabel")}</Label>
              <Input id="patient-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1.5" required />
              {fieldErrors.patientPhone ? <p className="text-destructive mt-1 text-xs">{fieldErrors.patientPhone[0]}</p> : null}
            </div>

            <div>
              <Label htmlFor="patient-email">{t("emailLabel")}</Label>
              <Input id="patient-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5" required />
              {fieldErrors.patientEmail ? <p className="text-destructive mt-1 text-xs">{fieldErrors.patientEmail[0]}</p> : null}
            </div>

            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={adultConfirmation}
                onChange={(event) => setAdultConfirmation(event.target.checked)}
                required
                className="mt-1 size-4 shrink-0"
              />
              <span className="text-muted-foreground">
                {locale === "ar"
                  ? "أصرّح بأن عمري 18 سنة أو أكثر. الحجز للقاصرين غير متاح عبر دويني في النسخة الحالية."
                  : "Je confirme avoir 18 ans ou plus. La réservation pour un mineur n’est pas disponible sur Dewini dans la version actuelle."}
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={privacyConsent}
                onChange={(event) => setPrivacyConsent(event.target.checked)}
                required
                className="mt-1 size-4 shrink-0"
              />
              <span className="text-muted-foreground">
                {locale === "ar"
                  ? "أوافق على معالجة بياناتي اللازمة لحجز وإدارة هذا الموعد وفق سياسة الخصوصية."
                  : "J’accepte le traitement des données nécessaires à la réservation et à la gestion de ce rendez-vous conformément à la politique de confidentialité."}{" "}
                <a
                  href={`/${locale}/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline underline-offset-4"
                >
                  {locale === "ar" ? "قراءة سياسة الخصوصية" : "Lire la politique de confidentialité"}
                </a>
              </span>
            </label>

            <Button
              type="submit"
              size="lg"
              disabled={submitting || !privacyConsent || !adultConfirmation}
              className="h-11 w-full"
            >
              {submitting ? t("submitting") : t("submitAction")}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
