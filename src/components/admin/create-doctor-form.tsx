"use client";

import {
  useState,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { createDoctorAction } from "@/app/[locale]/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deriveDoctorSlugSuggestion } from "@/lib/utils";

type Specialty = {
  id: string;
  name_fr: string;
  name_ar: string;
};

type LocationType =
  | "private_practice"
  | "clinic"
  | "hospital"
  | "medical_center"
  | "other";

function errorMessageFor(
  t: ReturnType<typeof useTranslations>,
  code: string,
): string {
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

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

export function CreateDoctorForm({
  specialties,
  defaultLocale,
}: {
  specialties: Specialty[];
  defaultLocale: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  // Doctor
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [specialtyId, setSpecialtyId] = useState(
    specialties[0]?.id ?? "",
  );
  const [locale, setLocale] = useState<"fr" | "ar">(
    defaultLocale === "ar" ? "ar" : "fr",
  );
  const [phone, setPhone] = useState("");
  const [bio, setBio] = useState("");

  // Photo
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Consultation location
  const [locationType, setLocationType] =
    useState<LocationType>("private_practice");
  const [clinicName, setClinicName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicCity, setClinicCity] = useState("");

  // Appointment
  const [appointmentTypeName, setAppointmentTypeName] =
    useState("Consultation");
  const [durationMinutes, setDurationMinutes] = useState(30);

  // Schedule
  const [workingDays, setWorkingDays] = useState<number[]>(
    DEFAULT_WORKING_DAYS,
  );
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");

  // Advanced
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [pageVariant, setPageVariant] = useState<
    "standard" | "custom"
  >("standard");
  const [customTemplateKey, setCustomTemplateKey] = useState("");

  // Request state
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dayOptions = [
    { day: 1, label: t("dayMonday") },
    { day: 2, label: t("dayTuesday") },
    { day: 3, label: t("dayWednesday") },
    { day: 4, label: t("dayThursday") },
    { day: 5, label: t("dayFriday") },
    { day: 6, label: t("daySaturday") },
    { day: 0, label: t("daySunday") },
  ];

  function handleFullNameChange(value: string) {
    setFullName(value);

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
      current.includes(day)
        ? current.filter((currentDay) => currentDay !== day)
        : [...current, day],
    );
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    setPhotoError(null);

    if (!file) {
      setPhoto(null);
      setPhotoPreview(null);
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setPhoto(null);
      setPhotoPreview(null);
      setPhotoError(t("photoTypeError"));
      event.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setPhoto(null);
      setPhotoPreview(null);
      setPhotoError(t("photoSizeError"));
      event.target.value = "";
      return;
    }

    setPhoto(file);

    const reader = new FileReader();

    reader.onload = () => {
      setPhotoPreview(
        typeof reader.result === "string" ? reader.result : null,
      );
    };

    reader.readAsDataURL(file);
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoError(null);

    const input = document.getElementById(
      "doctorPhoto",
    ) as HTMLInputElement | null;

    if (input) {
      input.value = "";
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const payload = {
        email,
        fullName,
        specialtyId,
        slug,
        defaultLocale: locale,
        bio: bio || undefined,
        phone: phone || undefined,
        pageVariant,
        customTemplateKey:
          pageVariant === "custom"
            ? customTemplateKey || undefined
            : undefined,
        clinic: {
          name: clinicName,
          address: clinicAddress,
          city: clinicCity,
          locationType,
        },
        appointmentTypeName,
        appointmentTypeDurationMinutes: durationMinutes,
        workingDays,
        workingStartTime: startTime,
        workingEndTime: endTime,
      };

      const formData = new FormData();

      formData.append("payload", JSON.stringify(payload));

      if (photo) {
        formData.append("photo", photo);
      }

      const result = await createDoctorAction(formData);

      if (!result.success) {
        setError(
          result.errorCode === "VALIDATION_ERROR"
            ? result.message
            : errorMessageFor(t, result.errorCode),
        );
        return;
      }

      router.push("/admin");
    });
  }

  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      onSubmit={handleSubmit}
    >
      {/* Doctor */}
      <section className="rounded-xl border p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold">
            {t("sectionDoctor")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("doctorSectionHint")}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {/* Photo */}
          <div className="flex flex-col gap-3">
            <Label htmlFor="doctorPhoto">{t("photoLabel")}</Label>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="bg-muted flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                {photoPreview ? (
                  <img
                    src={photoPreview}
                    alt={t("photoLabel")}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("photoPlaceholder")}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <Input
                  id="doctorPhoto"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                />

                <p className="text-muted-foreground text-xs">
                  {t("photoHint")}
                </p>

                {photo ? (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={removePhoto}
                    >
                      {t("photoRemove")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            {photoError ? (
              <p className="text-destructive text-sm">
                {photoError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">
                {t("fullNameLabel")} *
              </Label>
              <Input
                id="fullName"
                required
                value={fullName}
                onChange={(event) =>
                  handleFullNameChange(event.target.value)
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="specialty">
                {t("specialtyLabel")} *
              </Label>
              <select
                id="specialty"
                required
                value={specialtyId}
                onChange={(event) =>
                  setSpecialtyId(event.target.value)
                }
                className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
              >
                {specialties.map((specialty) => (
                  <option key={specialty.id} value={specialty.id}>
                    {locale === "ar"
                      ? specialty.name_ar
                      : specialty.name_fr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">
                {t("emailLabel")} *
              </Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">
                {t("phoneLabel")}{" "}
                <span className="text-muted-foreground font-normal">
                  ({t("optionalLabel")})
                </span>
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="bio">
              {t("bioLabel")}{" "}
              <span className="text-muted-foreground font-normal">
                ({t("optionalLabel")})
              </span>
            </Label>
            <Textarea
              id="bio"
              rows={4}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
            />
          </div>

          <div className="flex max-w-xs flex-col gap-2">
            <Label htmlFor="defaultLocale">
              {t("defaultLocaleLabel")} *
            </Label>
            <select
              id="defaultLocale"
              value={locale}
              onChange={(event) =>
                setLocale(
                  event.target.value === "ar" ? "ar" : "fr",
                )
              }
              className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            >
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
            </select>
          </div>
        </div>
      </section>

      {/* Consultation location */}
      <section className="rounded-xl border p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold">
            {t("sectionLocation")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("locationSectionHint")}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="locationType">
              {t("locationTypeLabel")} *
            </Label>

            <select
              id="locationType"
              required
              value={locationType}
              onChange={(event) =>
                setLocationType(
                  event.target.value as LocationType,
                )
              }
              className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            >
              <option value="private_practice">
                {t("locationTypePrivatePractice")}
              </option>
              <option value="clinic">
                {t("locationTypeClinic")}
              </option>
              <option value="hospital">
                {t("locationTypeHospital")}
              </option>
              <option value="medical_center">
                {t("locationTypeMedicalCenter")}
              </option>
              <option value="other">
                {t("locationTypeOther")}
              </option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="clinicName">
              {t("locationNameLabel")} *
            </Label>
            <Input
              id="clinicName"
              required
              value={clinicName}
              onChange={(event) =>
                setClinicName(event.target.value)
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="clinicAddress">
              {t("clinicAddressLabel")} *
            </Label>
            <Input
              id="clinicAddress"
              required
              value={clinicAddress}
              onChange={(event) =>
                setClinicAddress(event.target.value)
              }
            />
          </div>

          <div className="flex max-w-md flex-col gap-2">
            <Label htmlFor="clinicCity">
              {t("clinicCityLabel")} *
            </Label>
            <Input
              id="clinicCity"
              required
              value={clinicCity}
              onChange={(event) =>
                setClinicCity(event.target.value)
              }
            />
          </div>
        </div>
      </section>

      {/* Appointment */}
      <section className="rounded-xl border p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold">
            {t("sectionAppointment")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("appointmentSectionHint")}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointmentTypeName">
              {t("appointmentTypeNameLabel")} *
            </Label>
            <Input
              id="appointmentTypeName"
              required
              value={appointmentTypeName}
              onChange={(event) =>
                setAppointmentTypeName(event.target.value)
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="durationMinutes">
              {t("durationMinutesLabel")} *
            </Label>
            <Input
              id="durationMinutes"
              type="number"
              min={5}
              max={480}
              step={5}
              required
              value={durationMinutes}
              onChange={(event) =>
                setDurationMinutes(Number(event.target.value))
              }
            />
          </div>
        </div>
      </section>

      {/* Schedule */}
      <section className="rounded-xl border p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold">
            {t("sectionSchedule")}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("scheduleSectionHint")}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t("workingDaysLabel")}</Label>

            <div className="flex flex-wrap gap-2">
              {dayOptions.map(({ day, label }) => {
                const selected = workingDays.includes(day);

                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleDay(day)}
                    className={
                      selected
                        ? "bg-primary text-primary-foreground min-w-12 rounded-lg border px-3 py-2 text-sm font-medium"
                        : "bg-background hover:bg-muted min-w-12 rounded-lg border px-3 py-2 text-sm"
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid max-w-md gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="startTime">
                {t("startTimeLabel")} *
              </Label>
              <Input
                id="startTime"
                type="time"
                required
                value={startTime}
                onChange={(event) =>
                  setStartTime(event.target.value)
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="endTime">
                {t("endTimeLabel")} *
              </Label>
              <Input
                id="endTime"
                type="time"
                required
                value={endTime}
                onChange={(event) =>
                  setEndTime(event.target.value)
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* Advanced */}
      <details className="rounded-xl border">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium sm:px-6">
          {t("sectionAdvanced")}
        </summary>

        <div className="flex flex-col gap-5 border-t p-5 sm:p-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="slug">{t("slugLabel")}</Label>

            <Input
              id="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(event) =>
                handleSlugChange(event.target.value)
              }
            />

            {slug ? (
              <p className="text-muted-foreground text-xs">
                {t("slugPreviewLabel")} /{locale}/doctors/{slug}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pageVariant">
              {t("pageVariantLabel")}
            </Label>

            <select
              id="pageVariant"
              value={pageVariant}
              onChange={(event) =>
                setPageVariant(
                  event.target.value as "standard" | "custom",
                )
              }
              className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            >
              <option value="standard">
                {t("pageVariantStandard")}
              </option>
              <option value="custom">
                {t("pageVariantCustom")}
              </option>
            </select>
          </div>

          {pageVariant === "custom" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="customTemplateKey">
                {t("customTemplateKeyLabel")}
              </Label>

              <Input
                id="customTemplateKey"
                value={customTemplateKey}
                onChange={(event) =>
                  setCustomTemplateKey(event.target.value)
                }
              />

              <p className="text-muted-foreground text-xs">
                {t("customTemplateKeyHint")}
              </p>
            </div>
          ) : null}
        </div>
      </details>

      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={pending}
          className="min-w-40"
        >
          {pending
            ? t("creating")
            : t("createDoctorSubmit")}
        </Button>
      </div>
    </form>
  );
}
