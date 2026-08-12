import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FilterOption = { value: string; label: string };

/**
 * Plain native `<form method="get">` — no client component, no JS
 * required. Submitting re-navigates to the same page with `?specialty=` /
 * `?city=` search params, which the (server) page reads directly. See
 * PROJECT_SPEC.md "Public doctor search (M2.5)" for why filtering itself
 * happens in the page rather than here.
 */
export function DoctorSearchFilters({
  specialtyOptions,
  cityOptions,
  selectedSpecialty,
  selectedCity,
  selectedQuery,
  labels,
}: {
  specialtyOptions: FilterOption[];
  cityOptions: FilterOption[];
  selectedSpecialty?: string;
  selectedCity?: string;
  selectedQuery?: string;
  labels: {
    specialtyLabel: string;
    specialtyAll: string;
    cityLabel: string;
    cityAll: string;
    queryLabel: string;
    queryPlaceholder: string;
    searchAction: string;
  };
}) {
  const selectClassName =
    "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 mt-1.5 h-11 w-full rounded-xl border px-3 text-sm shadow-xs transition-all outline-none focus-visible:ring-3";

  return (
    <form
      method="get"
      className="bg-card/95 ring-foreground/8 grid min-w-0 grid-cols-1 gap-4 rounded-2xl p-4 shadow-md ring-1 sm:grid-cols-2 sm:p-6 xl:grid-cols-[1.35fr_1fr_1fr_auto] xl:items-end"
    >
      <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <label htmlFor="q" className="text-foreground text-sm font-medium">
          {labels.queryLabel}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={selectedQuery ?? ""}
          placeholder={labels.queryPlaceholder}
          className={selectClassName}
        />
      </div>

      <div className="min-w-0">
        <label htmlFor="specialty" className="text-foreground text-sm font-medium">
          {labels.specialtyLabel}
        </label>
        <select
          id="specialty"
          name="specialty"
          defaultValue={selectedSpecialty ?? ""}
          className={selectClassName}
        >
          <option value="">{labels.specialtyAll}</option>
          {specialtyOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label htmlFor="city" className="text-foreground text-sm font-medium">
          {labels.cityLabel}
        </label>
        <select id="city" name="city" defaultValue={selectedCity ?? ""} className={selectClassName}>
          <option value="">{labels.cityAll}</option>
          {cityOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="lg" className="h-11 gap-2 sm:col-span-2 xl:col-span-1">
        <Search className="size-4" aria-hidden />
        {labels.searchAction}
      </Button>
    </form>
  );
}
