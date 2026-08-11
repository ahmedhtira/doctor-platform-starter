"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateDoctorAction } from "@/app/[locale]/(admin)/admin/actions";
import type { Database } from "@/lib/supabase/database.types";

type Specialty = { id: string; name_fr: string; name_ar: string };
type DoctorRow = Database["public"]["Tables"]["doctors"]["Row"];

function errorMessageFor(t: ReturnType<typeof useTranslations>, code: string): string {
  switch (code) {
    case "SLUG_TAKEN":
      return t("errorSlugTaken");
    case "NOT_FOUND":
      return t("errorNotFound");
    default:
      return t("errorGeneric");
  }
}

/**
 * Deliberately not the same component as CreateDoctorForm — the field
 * sets genuinely differ (no email/clinic/appointment-type/hours here;
 * those stay owned by the doctor's own /dashboard/availability page
 * once they've logged in), not one component bent to fit two shapes.
 */
export function EditDoctorForm({
  doctor,
  specialties,
  locale,
}: {
  doctor: DoctorRow;
  specialties: Specialty[];
  locale: string;
}) {
  const t = useTranslations("admin");
  const router = useRouter();

  const [fullName, setFullName] = useState(doctor.full_name);
  const [specialtyId, setSpecialtyId] = useState(doctor.specialty_id);
  const [slug, setSlug] = useState(doctor.slug);
  const [defaultLocale, setDefaultLocale] = useState(doctor.default_locale);
  const [timezone, setTimezone] = useState(doctor.timezone);
  const [minBookingNoticeMinutes, setMinBookingNoticeMinutes] = useState(doctor.min_booking_notice_minutes);
  const [bio, setBio] = useState(doctor.bio ?? "");
  const [phone, setPhone] = useState(doctor.phone ?? "");
  const [pageVariant, setPageVariant] = useState<"standard" | "custom">(
    doctor.page_variant === "custom" ? "custom" : "standard",
  );
  const [customTemplateKey, setCustomTemplateKey] = useState(doctor.custom_template_key ?? "");

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateDoctorAction({
        doctorId: doctor.id,
        fullName,
        specialtyId,
        slug,
        defaultLocale,
        timezone,
        minBookingNoticeMinutes,
        bio: bio || undefined,
        phone: phone || undefined,
        pageVariant,
        customTemplateKey: pageVariant === "custom" ? customTemplateKey || undefined : undefined,
      });

      if (!result.success) {
        setError(errorMessageFor(t, result.errorCode));
        return;
      }

      router.push("/admin");
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">{t("fullNameLabel")}</Label>
        <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
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
          onChange={(e) => setSlug(e.target.value)}
        />
        {slug ? (
          <p className="text-muted-foreground text-xs">
            {t("slugPreviewLabel")} /{defaultLocale}/doctors/{slug}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="defaultLocale">{t("defaultLocaleLabel")}</Label>
        <select
          id="defaultLocale"
          value={defaultLocale}
          onChange={(e) => setDefaultLocale(e.target.value)}
          className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
        >
          <option value="fr">Français</option>
          <option value="ar">العربية</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">{t("timezoneLabel")}</Label>
        <Input id="timezone" required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="minBookingNoticeMinutes">{t("minBookingNoticeLabel")}</Label>
        <Input
          id="minBookingNoticeMinutes"
          type="number"
          min={0}
          required
          value={minBookingNoticeMinutes}
          onChange={(e) => setMinBookingNoticeMinutes(Number(e.target.value))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">{t("phoneLabel")}</Label>
        <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="bio">{t("bioLabel")}</Label>
        <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} />
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

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? t("saving") : t("saveAction")}
      </Button>
    </form>
  );
}
