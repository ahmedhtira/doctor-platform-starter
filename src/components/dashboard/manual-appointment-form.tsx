"use client";

import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { createStaffAppointmentAction } from "@/app/[locale]/(dashboard)/dashboard/actions";

export type ManualAppointmentClinicOption = {
  id: string;
  name: string;
  timezone: string;
};

export type ManualAppointmentTypeOption = {
  id: string;
  name: string;
  durationMinutes: number;
};

function actionErrorMessage(
  t: ReturnType<typeof useTranslations>,
  code: string,
): string {
  switch (code) {
    case "SLOT_UNAVAILABLE":
      return t("errorSlotUnavailable");
    case "SCHEDULE_CHANGED":
      return t("errorSchedule");
    case "UNAUTHENTICATED":
    case "SESSION_INVALID":
      return t("errorSession");
    case "VALIDATION_ERROR":
      return t("errorValidation");
    default:
      return t("errorUnknown");
  }
}

export function ManualAppointmentForm({
  doctorId,
  clinics,
  appointmentTypes,
  defaultDate,
}: {
  doctorId: string;
  clinics: ManualAppointmentClinicOption[];
  appointmentTypes: ManualAppointmentTypeOption[];
  defaultDate: string;
}) {
  const t = useTranslations("dashboard.manualAppointment");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? "");
  const [appointmentTypeId, setAppointmentTypeId] = useState(appointmentTypes[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("09:00");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [notes, setNotes] = useState("");

  const canCreate = clinics.length > 0 && appointmentTypes.length > 0;

  function resetPatientFields() {
    setPatientName("");
    setPatientPhone("");
    setPatientEmail("");
    setNotes("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const clinic = clinics.find((item) => item.id === clinicId);
    if (!clinic || !appointmentTypeId || !date || !time) {
      setError(t("errorValidation"));
      return;
    }

    const startsAt = DateTime.fromISO(`${date}T${time}`, { zone: clinic.timezone });
    if (!startsAt.isValid) {
      setError(t("errorValidation"));
      return;
    }

    startTransition(async () => {
      const result = await createStaffAppointmentAction({
        doctorId,
        clinicId,
        appointmentTypeId,
        startsAt: startsAt.toISO(),
        patientName,
        patientPhone,
        patientEmail: patientEmail.trim() || null,
        notes: notes.trim() || null,
      });

      if (!result.success) {
        setError(actionErrorMessage(t, result.errorCode));
        return;
      }

      resetPatientFields();
      setOpen(false);
      setSuccess(true);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(false);
            setOpen(true);
          }}
          disabled={!canCreate}
          className="gap-2"
        >
          <Plus className="size-4" aria-hidden />
          {t("addAction")}
        </Button>
        {success ? <p className="text-sm font-medium text-emerald-700">{t("success")}</p> : null}
        {!canCreate ? <p className="text-muted-foreground text-sm">{t("missingConfiguration")}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-card w-full rounded-2xl border p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-medium">{t("title")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t("description")}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          disabled={pending}
          aria-label={t("closeAction")}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium">
          {t("patientNameLabel")}
          <input
            required
            maxLength={120}
            value={patientName}
            onChange={(event) => setPatientName(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {t("patientPhoneLabel")}
          <input
            required
            maxLength={40}
            inputMode="tel"
            value={patientPhone}
            onChange={(event) => setPatientPhone(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {t("patientEmailLabel")}
          <input
            type="email"
            maxLength={254}
            value={patientEmail}
            onChange={(event) => setPatientEmail(event.target.value)}
            placeholder={t("optionalPlaceholder")}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          />
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {t("clinicLabel")}
          <select
            required
            value={clinicId}
            onChange={(event) => setClinicId(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          >
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>
                {clinic.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          {t("appointmentTypeLabel")}
          <select
            required
            value={appointmentTypeId}
            onChange={(event) => setAppointmentTypeId(event.target.value)}
            className="border-input bg-background h-10 rounded-lg border px-3 font-normal outline-none focus-visible:ring-2"
          >
            {appointmentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {type.durationMinutes} min
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            {t("dateLabel")}
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="border-input bg-background h-10 min-w-0 rounded-lg border px-2 font-normal outline-none focus-visible:ring-2"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t("timeLabel")}
            <input
              required
              type="time"
              step={900}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="border-input bg-background h-10 min-w-0 rounded-lg border px-2 font-normal outline-none focus-visible:ring-2"
            />
          </label>
        </div>

        <label className="grid gap-1.5 text-sm font-medium sm:col-span-2 lg:col-span-3">
          {t("notesLabel")}
          <textarea
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("optionalPlaceholder")}
            className="border-input bg-background resize-y rounded-lg border px-3 py-2 font-normal outline-none focus-visible:ring-2"
          />
        </label>
      </div>

      {error ? <p className="text-destructive mt-4 text-sm">{error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !canCreate}>
          {pending ? t("creating") : t("confirmAction")}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          {t("cancelAction")}
        </Button>
      </div>
    </form>
  );
}
