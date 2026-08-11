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
    "border-input focus-visible:border-ring focus-visible:ring-ring/50 mt-1.5 h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3";

  return (
    <form
      method="get"
      className="bg-card ring-foreground/8 flex flex-col gap-4 rounded-xl p-4 shadow-sm ring-1 sm:flex-row sm:items-end sm:p-5"
    >
      <div className="flex-1">
        <label htmlFor="q" className="text-muted-foreground text-sm font-medium">
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

      <div className="flex-1">
        <label htmlFor="specialty" className="text-muted-foreground text-sm font-medium">
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

      <div className="flex-1">
        <label htmlFor="city" className="text-muted-foreground text-sm font-medium">
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

      <Button type="submit" className="sm:w-auto">
        {labels.searchAction}
      </Button>
    </form>
  );
}
