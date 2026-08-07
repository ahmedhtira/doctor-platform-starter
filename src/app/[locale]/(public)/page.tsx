import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import {
  DoctorSearchFilters,
  type FilterOption,
} from "@/components/doctor-search/doctor-search-filters";
import {
  DoctorResultCard,
  type DoctorSearchResult,
} from "@/components/doctor-search/doctor-result-card";

export const dynamic = "force-dynamic";

type SearchParams = { specialty?: string; city?: string };

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
  const { specialty: selectedSpecialty, city: selectedCity } = await searchParams;
  const t = await getTranslations();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("doctors")
    .select(
      `
      slug, full_name,
      specialties ( slug, name_fr, name_ar ),
      clinics ( city )
    `,
    )
    .eq("is_published", true)
    .order("full_name");

  if (error) {
    throw new Error(`Failed to load doctors: ${error.message}`);
  }

  const doctors = data ?? [];

  const specialtyName = (specialty?: { name_fr: string; name_ar: string } | null) =>
    specialty ? (locale === "ar" ? specialty.name_ar : specialty.name_fr) : null;

  const specialtyOptionsMap = new Map<string, string>();
  const cityOptionsSet = new Set<string>();

  for (const doctor of doctors) {
    if (doctor.specialties) {
      specialtyOptionsMap.set(
        doctor.specialties.slug,
        specialtyName(doctor.specialties) ?? doctor.specialties.slug,
      );
    }
    for (const clinic of doctor.clinics) {
      if (clinic.city) {
        cityOptionsSet.add(clinic.city);
      }
    }
  }

  const specialtyOptions: FilterOption[] = [...specialtyOptionsMap.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  const cityOptions: FilterOption[] = [...cityOptionsSet]
    .sort((a, b) => a.localeCompare(b, locale))
    .map((city) => ({ value: city, label: city }));

  const results: DoctorSearchResult[] = doctors
    .filter((doctor) => !selectedSpecialty || doctor.specialties?.slug === selectedSpecialty)
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
            labels={{
              specialtyLabel: t("home.specialtyLabel"),
              specialtyAll: t("home.specialtyAll"),
              cityLabel: t("home.cityLabel"),
              cityAll: t("home.cityAll"),
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
