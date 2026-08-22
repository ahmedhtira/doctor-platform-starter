"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SlotPicker } from "@/components/booking/slot-picker";
import {
  applyStaffAppointmentDelayAction,
  cancelAppointmentAction,
  getStaffRescheduleSlotsAction,
  previewStaffAppointmentDelayAction,
  recordAppointmentOutcomeAction,
  rescheduleAppointmentAction,
} from "@/app/[locale]/(dashboard)/dashboard/actions";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import type { DashboardAppointment } from "@/lib/dashboard/fetch-dashboard-appointments";
import type { AppointmentOutcome } from "@/lib/dashboard/record-staff-appointment-outcome";
import type { StaffDelayPlan } from "@/lib/dashboard/staff-schedule-actions";
import { isoDateInTimeZone } from "@/lib/datetime/local-date";

type Mode =
  | "view"
  | "confirmingCancel"
  | "confirmingOutcome"
  | "rescheduling"
  | "rescheduled"
  | "delaying"
  | "delayApplied";

const DELAY_COPY = {
  fr: {
    action: "Décaler la suite",
    title: "Décaler la suite",
    description:
      "Prolongez ce rendez-vous et laissez Dewini déplacer uniquement les rendez-vous réellement affectés. Les créneaux libres absorbent automatiquement le retard.",
    custom: "Personnalisé",
    previewing: "Calcul…",
    previewAction: "Prévisualiser",
    previewTitle: "Aperçu des changements",
    anchorEnd: (oldTime: string, newTime: string) =>
      `Fin de ce rendez-vous : ${oldTime} → ${newTime}`,
    contactRequired: "Patient à prévenir",
    noOtherAppointments:
      "Aucun autre rendez-vous ne doit être déplacé : le retard est absorbé par un créneau libre.",
    applying: "Décalage…",
    confirmAction: "Confirmer le décalage",
    successTitle: "Planning mis à jour",
    successMessage: (minutes: number, count: number) =>
      `Retard de ${minutes} min appliqué. ${count} rendez-vous déplacé${count > 1 ? "s" : ""}.`,
    patientsToContact: "Patients à prévenir",
    emailNotice: "Les patients concernés avec une adresse e-mail seront prévenus automatiquement.",
  },
  ar: {
    action: "تأخير المواعيد التالية",
    title: "تأخير المواعيد التالية",
    description:
      "مدّد هذا الموعد وسيقوم دويني بتحريك المواعيد المتأثرة فقط. أي فراغ متاح في الجدول يمتص التأخير تلقائيًا.",
    custom: "مخصص",
    previewing: "جارٍ الحساب…",
    previewAction: "معاينة",
    previewTitle: "معاينة التغييرات",
    anchorEnd: (oldTime: string, newTime: string) =>
      `نهاية هذا الموعد: ${oldTime} ← ${newTime}`,
    contactRequired: "يجب إبلاغ المريض",
    noOtherAppointments: "لا حاجة لتحريك مواعيد أخرى لأن وقت الفراغ امتص التأخير.",
    applying: "جارٍ التأخير…",
    confirmAction: "تأكيد التأخير",
    successTitle: "تم تحديث الجدول",
    successMessage: (minutes: number, count: number) =>
      `تم تطبيق تأخير قدره ${minutes} دقيقة وتحريك ${count} موعد.`,
    patientsToContact: "مرضى يجب إبلاغهم",
    emailNotice: "سيتم إبلاغ المرضى المعنيين الذين لديهم بريد إلكتروني تلقائيًا.",
  },
} as const;

function errorMessageFor(t: ReturnType<typeof useTranslations>, code: string): string {
  switch (code) {
    case "APPOINTMENT_NOT_FOUND":
      return t("errorAppointmentNotFound");
    case "NOT_MODIFIABLE":
    case "APPOINTMENT_STARTED":
      return t("errorNotModifiable");
    case "SLOT_UNAVAILABLE":
      return t("errorSlotUnavailable");
    case "SCHEDULE_CHANGED":
      return t("errorScheduleChanged");
    case "NOT_YET_ENDED":
      return t("errorNotYetEnded");
    case "UNAUTHENTICATED":
    case "SESSION_INVALID":
      return t("errorUnauthenticated");
    default:
      return t("errorUnknown");
  }
}

function formatTime(iso: string, timezone: string, locale: string): string {
  const intlLocale = locale === "ar" ? "ar-TN-u-nu-latn" : "fr-TN";
  return new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

export function AppointmentActions({
  appointment,
  locale,
  allowDelay = false,
}: {
  appointment: DashboardAppointment;
  locale: string;
  allowDelay?: boolean;
}) {
  const t = useTranslations("dashboard.appointmentActions");
  const delayCopy = locale === "ar" ? DELAY_COPY.ar : DELAY_COPY.fr;
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("view");
  const [actionPending, startActionTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<AppointmentOutcome | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startsAtMs = new Date(appointment.startsAt).getTime();
  const endsAtMs = new Date(appointment.endsAt).getTime();
  const hasStarted = startsAtMs <= nowMs;
  const hasEnded = endsAtMs <= nowMs;

  // Update exactly when the appointment crosses its start/end boundary.
  // This avoids a polling interval per appointment while keeping a Today
  // screen left open at reception accurate without a manual refresh.
  useEffect(() => {
    const nextBoundary = [startsAtMs, endsAtMs]
      .filter((value) => Number.isFinite(value) && value > nowMs)
      .sort((a, b) => a - b)[0];
    if (nextBoundary === undefined) return;

    const delay = Math.max(0, nextBoundary - Date.now() + 100);
    const timer = window.setTimeout(() => setNowMs(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [startsAtMs, endsAtMs, nowMs]);

  const [date, setDate] = useState(() => isoDateInTimeZone(appointment.clinicTimezone));
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, startSlotsTransition] = useTransition();
  const [rawSelectedSlotStart, setRawSelectedSlotStart] = useState<string | null>(null);
  const selectedSlotStart =
    rawSelectedSlotStart !== null && slots.some((slot) => slot.slotStart === rawSelectedSlotStart)
      ? rawSelectedSlotStart
      : null;

  const [rescheduled, setRescheduled] = useState<{
    startsAt: string;
    managementToken: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const [delayMinutes, setDelayMinutes] = useState(30);
  const [delayPlan, setDelayPlan] = useState<StaffDelayPlan | null>(null);
  const [appliedDelayPlan, setAppliedDelayPlan] = useState<StaffDelayPlan | null>(null);

  const refreshSlots = useCallback(
    (forDate: string) => {
      startSlotsTransition(async () => {
        const result = await getStaffRescheduleSlotsAction({
          appointmentId: appointment.id,
          localDate: forDate,
        });
        setSlots(result.success ? result.slots : []);
      });
    },
    [appointment.id],
  );

  function beginReschedule() {
    setActionError(null);
    setMode("rescheduling");
    setRawSelectedSlotStart(null);
    refreshSlots(date);
  }

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setRawSelectedSlotStart(null);
    refreshSlots(nextDate);
  }

  function handleCancel() {
    startActionTransition(async () => {
      const result = await cancelAppointmentAction({ appointmentId: appointment.id });
      if (result.success) {
        router.refresh();
        return;
      }
      setActionError(errorMessageFor(t, result.errorCode));
      setMode("view");
    });
  }

  function handleRecordOutcome() {
    if (!pendingOutcome) return;
    startActionTransition(async () => {
      const result = await recordAppointmentOutcomeAction({
        appointmentId: appointment.id,
        outcome: pendingOutcome,
      });
      if (result.success) {
        router.refresh();
        return;
      }
      setActionError(errorMessageFor(t, result.errorCode));
      setMode("view");
    });
  }

  function handleConfirmReschedule() {
    if (!selectedSlotStart) return;
    startActionTransition(async () => {
      const result = await rescheduleAppointmentAction({
        appointmentId: appointment.id,
        newStartsAt: selectedSlotStart,
      });
      if (result.success) {
        setRescheduled({
          startsAt: result.appointment.starts_at,
          managementToken: result.managementToken,
        });
        setMode("rescheduled");
        return;
      }

      if (result.errorCode === "SLOT_UNAVAILABLE" || result.errorCode === "SCHEDULE_CHANGED") {
        setActionError(errorMessageFor(t, result.errorCode));
        setRawSelectedSlotStart(null);
        refreshSlots(date);
        return;
      }

      setActionError(errorMessageFor(t, result.errorCode));
    });
  }

  function previewDelay(minutes: number) {
    const safeMinutes = Math.max(1, Math.min(240, Math.round(minutes)));
    setDelayMinutes(safeMinutes);
    setActionError(null);
    setDelayPlan(null);
    startActionTransition(async () => {
      const result = await previewStaffAppointmentDelayAction({
        appointmentId: appointment.id,
        delayMinutes: safeMinutes,
      });
      if (result.success) {
        setDelayPlan(result.plan);
        return;
      }
      setActionError(errorMessageFor(t, result.errorCode));
    });
  }

  function applyDelay() {
    if (!delayPlan) return;
    setActionError(null);
    startActionTransition(async () => {
      const result = await applyStaffAppointmentDelayAction({
        appointmentId: appointment.id,
        delayMinutes: delayPlan.delay_minutes,
      });
      if (result.success) {
        setAppliedDelayPlan(result.plan);
        setDelayPlan(null);
        setMode("delayApplied");
        router.refresh();
        return;
      }
      setActionError(errorMessageFor(t, result.errorCode));
      setDelayPlan(null);
    });
  }

  const managementLink = useMemo(() => {
    if (!rescheduled || typeof window === "undefined") return "";
    return `${window.location.origin}/${locale}/manage#token=${rescheduled.managementToken}`;
  }, [rescheduled, locale]);

  async function handleCopyLink() {
    if (!managementLink) return;
    await navigator.clipboard.writeText(managementLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (mode === "delayApplied" && appliedDelayPlan) {
    const needsContact = appliedDelayPlan.affected.filter((item) => item.needs_contact);
    return (
      <div className="border-primary/20 bg-primary/5 mt-3 space-y-3 rounded-lg border p-3 text-sm">
        <p className="font-medium">{delayCopy.successTitle}</p>
        <p className="text-muted-foreground">
          {delayCopy.successMessage(
            appliedDelayPlan.delay_minutes,
            appliedDelayPlan.affected_count,
          )}
        </p>
        {needsContact.length > 0 ? (
          <div className="border-border rounded-md border bg-background/70 p-2.5">
            <p className="font-medium">{delayCopy.patientsToContact}</p>
            <ul className="mt-1 space-y-1">
              {needsContact.map((item) => (
                <li key={item.appointment_id} className="text-muted-foreground">
                  {item.patient_name} · {item.patient_phone}
                </li>
              ))}
            </ul>
          </div>
        ) : appliedDelayPlan.affected_count > 0 ? (
          <p className="text-muted-foreground">{delayCopy.emailNotice}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setAppliedDelayPlan(null);
            setMode("view");
          }}
        >
          {t("backToAppointment")}
        </Button>
      </div>
    );
  }

  if (mode === "delaying") {
    return (
      <div className="border-border mt-3 space-y-4 rounded-lg border p-3">
        <div>
          <p className="font-medium">{delayCopy.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{delayCopy.description}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[15, 30, 45].map((minutes) => (
            <Button
              key={minutes}
              type="button"
              size="sm"
              variant={delayMinutes === minutes ? "default" : "outline"}
              disabled={actionPending}
              onClick={() => previewDelay(minutes)}
            >
              +{minutes} min
            </Button>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{delayCopy.custom}</span>
            <input
              type="number"
              min={1}
              max={240}
              value={delayMinutes}
              onChange={(event) => {
                setDelayMinutes(Number(event.target.value));
                setDelayPlan(null);
              }}
              className="border-input bg-background h-8 w-20 rounded-md border px-2"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={actionPending || delayMinutes < 1 || delayMinutes > 240}
            onClick={() => previewDelay(delayMinutes)}
          >
            {actionPending ? delayCopy.previewing : delayCopy.previewAction}
          </Button>
        </div>

        {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}

        {delayPlan ? (
          <div className="bg-muted/40 space-y-3 rounded-lg p-3">
            <div>
              <p className="font-medium">{delayCopy.previewTitle}</p>
              <p className="text-muted-foreground text-sm">
                {delayCopy.anchorEnd(
                  formatTime(delayPlan.old_ends_at, appointment.clinicTimezone, locale),
                  formatTime(delayPlan.new_ends_at, appointment.clinicTimezone, locale),
                )}
              </p>
            </div>

            {delayPlan.affected.length > 0 ? (
              <ul className="space-y-2">
                {delayPlan.affected.map((item) => (
                  <li key={item.appointment_id} className="rounded-md border bg-background p-2">
                    <p className="font-medium">{item.patient_name}</p>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {formatTime(item.old_starts_at, appointment.clinicTimezone, locale)} →{" "}
                      {formatTime(item.new_starts_at, appointment.clinicTimezone, locale)}
                      {item.needs_contact ? ` · ${delayCopy.contactRequired}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{delayCopy.noOtherAppointments}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={applyDelay} disabled={actionPending}>
                {actionPending ? delayCopy.applying : delayCopy.confirmAction}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actionPending}
                onClick={() => {
                  setDelayPlan(null);
                  setActionError(null);
                  setMode("view");
                }}
              >
                {t("rescheduleBackAction")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actionPending}
            onClick={() => {
              setActionError(null);
              setMode("view");
            }}
          >
            {t("rescheduleBackAction")}
          </Button>
        )}
      </div>
    );
  }

  if (mode === "rescheduled" && rescheduled) {
    return (
      <div className="border-border bg-muted/40 mt-3 space-y-3 rounded-lg border p-3 text-sm">
        <p className="font-medium">{t("rescheduleSuccessTitle")}</p>
        <p className="text-muted-foreground">{t("rescheduleSuccessMessage")}</p>
        <div>
          <p className="font-medium">{t("managementLinkTitle")}</p>
          <p className="text-muted-foreground mt-1">{t("managementLinkDescription")}</p>
          {managementLink ? <p className="mt-2 font-mono text-xs break-all">{managementLink}</p> : null}
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleCopyLink}>
              {copied ? t("copyLinkCopied") : t("copyLinkAction")}
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setMode("view");
            router.refresh();
          }}
        >
          {t("backToAppointment")}
        </Button>
      </div>
    );
  }

  if (mode === "rescheduling") {
    return (
      <div className="border-border mt-3 space-y-4 rounded-lg border p-3">
        <SlotPicker
          date={date}
          onDateChange={handleDateChange}
          minDate={isoDateInTimeZone(appointment.clinicTimezone)}
          slots={slots}
          selectedSlotStart={selectedSlotStart}
          onSelectSlot={setRawSelectedSlotStart}
          clinicTimezone={appointment.clinicTimezone}
          locale={locale}
          loading={slotsLoading}
          dateLabel={t("rescheduleDateLabel")}
          loadingLabel={t("rescheduleSlotsLoading")}
          emptyLabel={t("rescheduleSlotsEmpty")}
        />

        {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleConfirmReschedule}
            disabled={!selectedSlotStart || actionPending}
          >
            {actionPending ? t("rescheduling") : t("rescheduleConfirmAction")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actionPending}
            onClick={() => {
              setActionError(null);
              setMode("view");
            }}
          >
            {t("rescheduleBackAction")}
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "confirmingCancel") {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm">{t("cancelConfirmPrompt")}</p>
        {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={handleCancel}
            disabled={actionPending}
          >
            {actionPending ? t("cancelling") : t("cancelConfirmYes")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMode("view")}
            disabled={actionPending}
          >
            {t("cancelConfirmNo")}
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "confirmingOutcome" && pendingOutcome) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm">
          {pendingOutcome === "completed" ? t("completeConfirmPrompt") : t("noShowConfirmPrompt")}
        </p>
        {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleRecordOutcome} disabled={actionPending}>
            {actionPending ? t("recordingOutcome") : t("outcomeConfirmYes")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setPendingOutcome(null);
              setMode("view");
            }}
            disabled={actionPending}
          >
            {t("outcomeConfirmNo")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={beginReschedule}>
          {t("rescheduleAction")}
        </Button>
        {allowDelay && hasStarted ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setActionError(null);
              setDelayPlan(null);
              setMode("delaying");
            }}
          >
            {delayCopy.action}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => {
            setActionError(null);
            setMode("confirmingCancel");
          }}
        >
          {t("cancelAction")}
        </Button>
        {hasEnded ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setActionError(null);
                setPendingOutcome("completed");
                setMode("confirmingOutcome");
              }}
            >
              {t("completeAction")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setActionError(null);
                setPendingOutcome("no_show");
                setMode("confirmingOutcome");
              }}
            >
              {t("noShowAction")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
