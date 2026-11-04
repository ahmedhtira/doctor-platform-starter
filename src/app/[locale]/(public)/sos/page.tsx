import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Clock3, MapPin, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listSosDoctors, phoneHref } from "@/lib/doctor-profile/list-sos-doctors";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sos" });
  return { title: t("title"), description: t("description") };
}

export default async function SosPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ city?: string | string[] }>;
}) {
  const { locale } = await params;
  const { city } = await searchParams;
  const selectedCity = typeof city === "string" ? city : "";
  const t = await getTranslations("sos");
  const doctors = await listSosDoctors(await createClient());
  const cities = [
    ...new Set(
      doctors.flatMap((doctor) =>
        doctor.clinics.flatMap((clinic) => (clinic.city ? [clinic.city] : [])),
      ),
    ),
  ].sort();
  const results = doctors.filter(
    (doctor) => !selectedCity || doctor.clinics.some((clinic) => clinic.city === selectedCity),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <span className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-900">
          <Clock3 className="size-4" aria-hidden />
          {t("badge")}
        </span>
        <h1 className="font-heading mt-4 text-3xl font-medium sm:text-5xl">{t("title")}</h1>
        <p className="text-muted-foreground mt-4 text-lg">{t("description")}</p>
        <p className="mt-3 text-sm">{t("callHint")}</p>
      </div>
      <form method="get" className="my-8 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <label htmlFor="sos-city" className="text-sm font-medium">
            {t("city")}
          </label>
          <select
            id="sos-city"
            name="city"
            defaultValue={selectedCity}
            className="border-input bg-background h-10 min-w-48 rounded-lg border px-3"
          >
            <option value="">{t("allCities")}</option>
            {selectedCity && !cities.includes(selectedCity) ? (
              <option value={selectedCity}>{selectedCity}</option>
            ) : null}
            {cities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button className={buttonVariants({ variant: "outline" })} type="submit">
          {t("filter")}
        </button>
        {selectedCity ? (
          <Link href="/sos" className="p-2 text-sm underline">
            {t("clear")}
          </Link>
        ) : null}
      </form>
      {results.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <h2 className="text-xl font-semibold">{t("emptyTitle")}</h2>
          <p className="text-muted-foreground mt-2">{t("emptyDescription")}</p>
          <Link href="/" className="mt-4 inline-block underline">
            {t("allDoctors")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((doctor) => {
            const contact = phoneHref(doctor.sos_phone);
            const specialty =
              locale === "ar" ? doctor.specialties?.name_ar : doctor.specialties?.name_fr;
            const area =
              doctor.sos_area ||
              [...new Set(doctor.clinics.map((clinic) => clinic.city).filter(Boolean))].join(" · ");
            return (
              <article
                key={doctor.id}
                className="bg-card flex flex-col rounded-2xl border p-6 shadow-sm"
              >
                <span className="text-sm font-semibold text-rose-800">{t("badge")}</span>
                <h2 className="font-heading mt-3 text-xl font-medium">{doctor.full_name}</h2>
                <p className="text-muted-foreground mt-1">{specialty}</p>
                {area ? (
                  <p className="mt-3 flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {area}
                  </p>
                ) : null}
                <div className="mt-auto space-y-3 pt-6">
                  {contact ? (
                    <a href={contact} className={buttonVariants({ className: "w-full" })}>
                      <Phone className="size-4" aria-hidden />
                      {t("call")} <bdi>{doctor.sos_phone}</bdi>
                    </a>
                  ) : null}
                  <Link
                    href={`/doctors/${doctor.slug}`}
                    className={buttonVariants({ variant: "outline", className: "w-full" })}
                  >
                    {t("profile")}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
