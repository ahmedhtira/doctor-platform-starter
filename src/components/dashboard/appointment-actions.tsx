"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SlotPicker } from "@/components/booking/slot-picker";
import {
  cancelAppointmentAction,
  getStaffRescheduleSlotsAction,
  rescheduleAppointmentAction,
} from "@/app/[locale]/(dashboard)/dashboard/actions";
import type { AvailableSlot } from "@/lib/availability/compute-available-slots";
import type { DashboardAppointment } from "@/lib/dashboard/fetch-dashboard-appointments";

type Mode = "view" | "confirmingCancel" | "rescheduling" | "rescheduled";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessageFor(t: ReturnType<typeof useTranslations>, code: string): string {
  switch (code) {
    case "APPOINTMENT_NOT_FOUND":
      return t("errorAppointmentNotFound");
    case "NOT_MODIFIABLE":
      return t("errorNotModifiable");
    case "SLOT_UNAVAILABLE":
      return t("errorSlotUnavailable");
    case "SCHEDULE_CHANGED":
      return t("errorScheduleChanged");
    case "UNAUTHENTICATED":
      return t("errorUnauthenticated");
    default:
      return t("errorUnknown");
  }
}

/**
 * Per-row cancel/reschedule controls, mirroring
 * managed-appointment-view.tsx's mode state machine
 * (view/confirmingCancel/rescheduling/rescheduled) — that UX language is
 * already validated in this codebase, just staff-phrased here. One
 * addition over the patient-facing version: a Copy button on the
 * post-reschedule management-link notice, since a doctor/secretary needs
 * to hand that link to the patient directly (by phone/SMS/etc.) until
 * automated email delivery exists — M6 doesn't send email.
 */
export function AppointmentActions({
  appointment,
  locale,
}: {
  appointment: DashboardAppointment;
  locale: string;
}) {
  const t = useTranslations("dashboard.appointmentActions");
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("view");
  const [actionPending, startActionTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const [date, setDate] = useState(todayIsoDate());
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

  function handleConfirmReschedule() {
    if (!selectedSlotStart) {
      return;
    }
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

  // window.location.origin is only available client-side — guarded for
  // this client component's (brief) server-render pass, same pattern as
  // booking-confirmation.tsx/managed-appointment-view.tsx.
  const managementLink = useMemo(() => {
    if (!rescheduled || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/${locale}/manage#token=${rescheduled.managementToken}`;
  }, [rescheduled, locale]);

  async function handleCopyLink() {
    if (!managementLink) return;
    await navigator.clipboard.writeText(managementLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (mode === "rescheduled" && rescheduled) {
    return (
      <div className="border-border bg-muted/40 mt-3 space-y-3 rounded-lg border p-3 text-sm">
        <p className="font-medium">{t("rescheduleSuccessTitle")}</p>
        <p className="text-muted-foreground">{t("rescheduleSuccessMessage")}</p>
        <div>
          <p className="font-medium">{t("managementLinkTitle")}</p>
          <p className="text-muted-foreground mt-1">{t("managementLinkDescription")}</p>
          {managementLink ? (
            <p className="mt-2 font-mono text-xs break-all">{managementLink}</p>
          ) : null}
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
          minDate={todayIsoDate()}
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

  return (
    <div className="mt-3 space-y-2">
      {actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={beginReschedule}>
          {t("rescheduleAction")}
        </Button>
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
      </div>
    </div>
  );
}
