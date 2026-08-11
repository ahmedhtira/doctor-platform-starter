import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
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
        return resolvedQuerySpecialtySlug !== null && doctor.specialties?.slug === resolvedQuerySpecialtySlug;
      }
      return !selectedSpecialty || doctor.specialties?.slug === selectedSpecialty;
    })
    .filter((doctor) => !selectedCity || doctor.clinics.some((clinic) => clinic.city === selectedCity))
    .map((doctor) => ({
      slug: doctor.slug,
      fullName: doctor.full_name,
      specialtyName: specialtyName(doctor.specialties),
      city: doctor.clinics[0]?.city ?? null,
    }));

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="from-primary/7 via-accent/5 pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem] bg-gradient-to-b to-transparent"
      />
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="text-accent text-sm font-semibold tracking-[0.14em] uppercase">
          {t("common.appName")}
        </p>
        <h1 className="font-heading mt-3 text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          {t("home.title")}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-relaxed">
          {t("home.description")}
        </p>

        <div className="mt-10">
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

        <div className="mt-10">
          {results.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {t("home.resultsEmpty")}
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((doctor) => (
                <DoctorResultCard
                  key={doctor.slug}
                  doctor={doctor}
                  viewProfileLabel={t("home.viewProfile")}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
