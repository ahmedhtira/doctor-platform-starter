"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createDoctorAction } from "@/app/[locale]/(admin)/admin/actions";
import { deriveDoctorSlugSuggestion } from "@/lib/utils";

type Specialty = { id: string; name_fr: string; name_ar: string };

function errorMessageFor(t: ReturnType<typeof useTranslations>, code: string): string {
  switch (code) {
    case "EMAIL_ALREADY_REGISTERED":
      return t("errorEmailAlreadyRegistered");
    case "SLUG_TAKEN":
      return t("errorSlugTaken");
    case "EMAIL_SEND_FAILED":
      return t("errorEmailSendFailed");
    default:
      return t("errorGeneric");
  }
}

const WEEKDAYS = [1, 2, 3, 4, 5] as const; // Postgres dow: Monday=1 ... Friday=5
const DAY_LABELS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

/**
 * Seeds one simple default schedule (day checkboxes + one start/end time
 * pair applied to all selected days) rather than a full per-day editor —
 * the existing /dashboard/availability page is already the fuller tool,
 * reachable the moment the doctor sets their password and logs in.
 */
export function CreateDoctorForm({
  specialties,
  defaultLocale,
}: {
  specialties: Specialty[];
  defaultLocale: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [specialtyId, setSpecialtyId] = useState(specialties[0]?.id ?? "");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [locale, setLocale] = useState(defaultLocale === "ar" ? "ar" : "fr");
  const [timezone, setTimezone] = useState("Africa/Tunis");
  const [bio, setBio] = useState("");
  const [phone, setPhone] = useState("");
  const [pageVariant, setPageVariant] = useState<"standard" | "custom">("standard");
  const [customTemplateKey, setCustomTemplateKey] = useState("");

  const [clinicName, setClinicName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicCity, setClinicCity] = useState("");

  const [appointmentTypeName, setAppointmentTypeName] = useState("Consultation");
  const [durationMinutes, setDurationMinutes] = useState(30);

  const [workingDays, setWorkingDays] = useState<number[]>([...WEEKDAYS]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFullNameChange(value: string) {
    setFullName(value);
    // Auto-suggest the slug from the name, but only until the admin
    // touches the slug field themselves -- once they have, their edit
    // wins and typing more of the name never overwrites it again.
    if (!slugManuallyEdited) {
      setSlug(deriveDoctorSlugSuggestion(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlug(value);
    setSlugManuallyEdited(true);
  }

  function toggleDay(day: number) {
    setWorkingDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDoctorAction({
        email,
        fullName,
        specialtyId,
        slug,
        defaultLocale: locale,
        timezone,
        bio: bio || undefined,
        phone: phone || undefined,
        pageVariant,
        customTemplateKey: pageVariant === "custom" ? customTemplateKey || undefined : undefined,
        clinic: { name: clinicName, address: clinicAddress, city: clinicCity || undefined, timezone },
        appointmentTypeName,
        appointmentTypeDurationMinutes: durationMinutes,
        workingDays,
        workingStartTime: startTime,
        workingEndTime: endTime,
      });

      if (!result.success) {
        setError(errorMessageFor(t, result.errorCode));
        return;
      }

      router.push("/admin");
    });
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("sectionAccount")}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName">{t("fullNameLabel")}</Label>
          <Input
            id="fullName"
            required
            value={fullName}
            onChange={(e) => handleFullNameChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="specialty">{t("specialtyLabel")}</Label>
          <select
            id="specialty"
            required
            value={specialtyId}
            onChange={(e) => setSpecialtyId(e.target.value)}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            {specialties.map((specialty) => (
              <option key={specialty.id} value={specialty.id}>
                {locale === "ar" ? specialty.name_ar : specialty.name_fr}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">{t("slugLabel")}</Label>
          <Input
            id="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
          />
          {slug ? (
            <p className="text-muted-foreground text-xs">
              {t("slugPreviewLabel")} /{locale}/doctors/{slug}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">{t("phoneLabel")}</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bio">{t("bioLabel")}</Label>
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("sectionPage")}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="defaultLocale">{t("defaultLocaleLabel")}</Label>
          <select
            id="defaultLocale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pageVariant">{t("pageVariantLabel")}</Label>
          <select
            id="pageVariant"
            value={pageVariant}
            onChange={(e) => setPageVariant(e.target.value as "standard" | "custom")}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            <option value="standard">{t("pageVariantStandard")}</option>
            <option value="custom">{t("pageVariantCustom")}</option>
          </select>
        </div>
        {pageVariant === "custom" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="customTemplateKey">{t("customTemplateKeyLabel")}</Label>
            <Input
              id="customTemplateKey"
              value={customTemplateKey}
              onChange={(e) => setCustomTemplateKey(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t("customTemplateKeyHint")}</p>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("sectionClinic")}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="clinicName">{t("clinicNameLabel")}</Label>
          <Input id="clinicName" required value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="clinicAddress">{t("clinicAddressLabel")}</Label>
          <Input
            id="clinicAddress"
            required
            value={clinicAddress}
            onChange={(e) => setClinicAddress(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="clinicCity">{t("clinicCityLabel")}</Label>
          <Input id="clinicCity" value={clinicCity} onChange={(e) => setClinicCity(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">{t("timezoneLabel")}</Label>
          <Input id="timezone" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("sectionSchedule")}</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="appointmentTypeName">{t("appointmentTypeNameLabel")}</Label>
          <Input
            id="appointmentTypeName"
            required
            value={appointmentTypeName}
            onChange={(e) => setAppointmentTypeName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="durationMinutes">{t("durationMinutesLabel")}</Label>
          <Input
            id="durationMinutes"
            type="number"
            min={5}
            max={480}
            required
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("workingDaysLabel")}</Label>
          <div className="flex gap-2">
            {DAY_LABELS_FR.map((label, day) => (
              <label key={day} className="flex flex-col items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={workingDays.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="startTime">{t("startTimeLabel")}</Label>
            <Input
              id="startTime"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="endTime">{t("endTimeLabel")}</Label>
            <Input
              id="endTime"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>
      </section>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("createDoctorSubmit")}
      </Button>
    </form>
  );
}
