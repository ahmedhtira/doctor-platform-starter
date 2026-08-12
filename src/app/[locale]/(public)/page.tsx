import { getTranslations } from "next-intl/server";
import {
  CalendarCheck2,
  Languages,
  Search,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listSpecialties } from "@/lib/specialties/list-specialties";
import { listSpecialtyAliases } from "@/lib/specialties/list-specialty-aliases";
import { resolveSpecialtyFromQuery } from "@/lib/specialties/resolve-specialty-query";
import {
  DoctorSearchFilters,
  type FilterOption,
} from "@/components/doctor-search/doctor-search-filters";
import {
  DoctorResultCard,
  type DoctorSearchResult,
} from "@/components/doctor-search/doctor-result-card";

export const dynamic = "force-dynamic";

type SearchParams = { specialty?: string; city?: string; q?: string };

// RLS-bound anon client, same as the doctor profile page — public search
// reads exactly the same published-doctor rows a direct profile visit
// would. Filtering happens in memory after one unfiltered fetch rather
// than as separate PostgREST queries; see PROJECT_SPEC.md "Public doctor
// search (M2.5)" for why that's the right call at this scale.
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const { specialty: selectedSpecialty, city: selectedCity, q: selectedQuery } = await searchParams;
  const t = await getTranslations();

  const supabase = await createClient();
  const [{ data, error }, specialties, specialtyAliases] = await Promise.all([
    supabase
      .from("doctors")
      .select(
        `
      slug, full_name,
      specialties ( slug, name_fr, name_ar ),
      clinics ( city )
    `,
      )
      .eq("is_published", true)
      .order("full_name"),
    listSpecialties(supabase),
    listSpecialtyAliases(supabase),
  ]);

  if (error) {
    throw new Error(`Failed to load doctors: ${error.message}`);
  }

  const doctors = data ?? [];

  // A free-text query ("cœur", "dentiste", "généraliste") takes priority
  // over the exact-match dropdown when both are somehow present — it's
  // the more specific patient intent. An unresolved query (no known
  // specialty/alias is a close enough match) filters to zero results,
  // the same "searched, found nothing" behavior the city filter already
  // has — it does not silently fall back to showing everyone.
  const hasQuery = Boolean(selectedQuery?.trim());
  const resolvedQuerySpecialtySlug = hasQuery
    ? resolveSpecialtyFromQuery(selectedQuery!, specialties, specialtyAliases)
    : null;

  const specialtyName = (specialty?: { name_fr: string; name_ar: string } | null) =>
    specialty ? (locale === "ar" ? specialty.name_ar : specialty.name_fr) : null;

  const cityOptionsSet = new Set<string>();

  for (const doctor of doctors) {
    for (const clinic of doctor.clinics) {
      if (clinic.city) {
        cityOptionsSet.add(clinic.city);
      }
    }
  }

  // The full specialty catalog, not just specialties a published doctor
  // currently has -- so the filter is populated (and a patient can browse
  // it) even before any doctor with a given specialty is live yet. Same
  // central public.specialties table the admin form's dropdown reads.
  const specialtyOptions: FilterOption[] = specialties
    .map((specialty) => ({
      value: specialty.slug,
      label: locale === "ar" ? specialty.name_ar : specialty.name_fr,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  const cityOptions: FilterOption[] = [...cityOptionsSet]
    .sort((a, b) => a.localeCompare(b, locale))
    .map((city) => ({ value: city, label: city }));

  const results: DoctorSearchResult[] = doctors
    .filter((doctor) => {
      if (hasQuery) {
        return (
          resolvedQuerySpecialtySlug !== null &&
          doctor.specialties?.slug === resolvedQuerySpecialtySlug
        );
      }
      return !selectedSpecialty || doctor.specialties?.slug === selectedSpecialty;
    })
    .filter(
      (doctor) => !selectedCity || doctor.clinics.some((clinic) => clinic.city === selectedCity),
    )
    .map((doctor) => ({
      slug: doctor.slug,
      fullName: doctor.full_name,
      specialtyName: specialtyName(doctor.specialties),
      city: doctor.clinics[0]?.city ?? null,
    }));

  const hasActiveFilters = Boolean(selectedSpecialty || selectedCity || selectedQuery?.trim());
  const trustPoints = [
    { icon: ShieldCheck, label: t("home.trust.noAccount") },
    { icon: Languages, label: t("home.trust.bilingual") },
    { icon: CalendarCheck2, label: t("home.trust.onlineBooking") },
  ];
  const steps = [
    {
      icon: Search,
      title: t("home.howItWorks.searchTitle"),
      description: t("home.howItWorks.searchDescription"),
    },
    {
      icon: UserRound,
      title: t("home.howItWorks.chooseTitle"),
      description: t("home.howItWorks.chooseDescription"),
    },
    {
      icon: CalendarCheck2,
      title: t("home.howItWorks.bookTitle"),
      description: t("home.howItWorks.bookDescription"),
    },
  ];

  return (
    <div className="overflow-hidden">
      <section className="relative">
        <div
          aria-hidden
          className="from-primary/10 via-accent/5 pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b to-transparent"
        />
        <div
          aria-hidden
          className="bg-accent/8 pointer-events-none absolute end-[-8rem] -top-24 -z-10 size-80 rounded-full blur-3xl"
        />

        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-3xl">
            <p className="text-accent text-sm font-semibold tracking-[0.14em] uppercase">
              {t("common.appName")}
            </p>
            <h1 className="font-heading mt-3 text-4xl leading-[1.08] font-medium tracking-tight text-balance sm:text-6xl">
              {t("home.title")}
            </h1>
            <p className="text-muted-foreground mt-5 max-w-2xl text-lg leading-relaxed sm:text-xl">
              {t("home.description")}
            </p>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2" aria-label={t("home.trust.label")}>
            {trustPoints.map(({ icon: Icon, label }) => (
              <li key={label} className="text-muted-foreground flex items-center gap-2 text-sm">
                <Icon className="text-primary size-4" aria-hidden />
                {label}
              </li>
            ))}
          </ul>

          <div className="mt-9">
            <DoctorSearchFilters
              specialtyOptions={specialtyOptions}
              cityOptions={cityOptions}
              selectedSpecialty={selectedSpecialty}
              selectedCity={selectedCity}
              selectedQuery={selectedQuery}
              labels={{
                specialtyLabel: t("home.specialtyLabel"),
                specialtyAll: t("home.specialtyAll"),
                cityLabel: t("home.cityLabel"),
                cityAll: t("home.cityAll"),
                queryLabel: t("home.queryLabel"),
                queryPlaceholder: t("home.queryPlaceholder"),
                searchAction: t("home.searchAction"),
              }}
            />
          </div>

          <div className="mt-12">
            {results.length === 0 ? (
              <div className="bg-card/70 flex flex-col items-center rounded-2xl border border-dashed px-5 py-12 text-center shadow-sm sm:px-10">
                <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
                  <Stethoscope className="size-6" aria-hidden />
                </span>
                <h2 className="font-heading mt-4 text-2xl font-medium">
                  {t(hasActiveFilters ? "home.filteredEmptyTitle" : "home.marketplaceEmptyTitle")}
                </h2>
                <p className="text-muted-foreground mt-2 max-w-lg leading-relaxed">
                  {t(
                    hasActiveFilters
                      ? "home.filteredEmptyDescription"
                      : "home.marketplaceEmptyDescription",
                  )}
                </p>
                {hasActiveFilters ? (
                  <Link
                    href="/"
                    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-6")}
                  >
                    {t("home.clearFilters")}
                  </Link>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-accent text-xs font-semibold tracking-[0.14em] uppercase">
                      {t("home.resultsEyebrow")}
                    </p>
                    <h2 className="font-heading mt-1 text-2xl font-medium sm:text-3xl">
                      {t("home.resultsCount", { count: results.length })}
                    </h2>
                  </div>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {results.map((doctor) => (
                    <DoctorResultCard
                      key={doctor.slug}
                      doctor={doctor}
                      viewProfileLabel={t("home.viewProfile")}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="border-border/70 bg-card/35 border-t">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-accent text-sm font-semibold tracking-[0.14em] uppercase">
              {t("home.howItWorks.eyebrow")}
            </p>
            <h2 className="font-heading mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
              {t("home.howItWorks.title")}
            </h2>
          </div>
          <ol className="mt-9 grid gap-4 md:grid-cols-3">
            {steps.map(({ icon: Icon, title, description }, index) => (
              <li key={title} className="bg-background rounded-2xl border p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-muted-foreground/60 text-sm font-semibold tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="font-heading mt-5 text-xl font-medium">{title}</h3>
                <p className="text-muted-foreground mt-2 leading-relaxed">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
