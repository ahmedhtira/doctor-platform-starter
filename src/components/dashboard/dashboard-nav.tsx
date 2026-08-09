"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { buildDashboardHref } from "@/lib/dashboard/dashboard-links";
import type { StaffDoctorSummary } from "@/lib/dashboard/auth-context";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { key: "today", path: "/dashboard" },
  { key: "calendar", path: "/dashboard/calendar" },
  { key: "availability", path: "/dashboard/availability" },
] as const;

/**
 * Nav links + doctor switcher live in one client component because both
 * need the same `doctorId` search param. Every nav link is built with
 * buildDashboardHref(path, {doctorId}) so switching sections never drops
 * the selected doctor (a secretary managing multiple doctors must not be
 * silently bounced back to their first doctor on navigation). The switcher
 * itself preserves whatever *other* params are already on the current page
 * (e.g. Calendar's `week`) — it only overwrites `doctorId`.
 */
export function DashboardNav({
  doctors,
  selectedDoctorId,
}: {
  doctors: StaffDoctorSummary[];
  selectedDoctorId: string;
}) {
  const t = useTranslations("dashboard.nav");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const doctorId = searchParams.get("doctorId") ?? selectedDoctorId;

  return (
    <nav className="flex flex-col gap-1 text-sm">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={buildDashboardHref(item.path, { doctorId })}
          className={cn(
            "rounded-md px-2 py-1.5 font-medium transition-colors",
            pathname === item.path
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(item.key)}
        </Link>
      ))}
      <span className="text-muted-foreground/60 px-2 py-1.5">{t("profile")}</span>
      <span className="text-muted-foreground/60 px-2 py-1.5">{t("staff")}</span>

      {doctors.length > 1 ? (
        <div className="mt-4 flex flex-col gap-1.5">
          <label
            htmlFor="doctor-switcher"
            className="text-muted-foreground px-2 text-xs font-medium"
          >
            {t("switchDoctorLabel")}
          </label>
          <select
            id="doctor-switcher"
            value={doctorId}
            onChange={(event) => {
              const params: Record<string, string | undefined> = Object.fromEntries(
                searchParams.entries(),
              );
              params.doctorId = event.target.value;
              router.replace(buildDashboardHref(pathname, params));
            }}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 mx-2 h-9 rounded-lg border bg-transparent px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3"
          >
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.fullName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </nav>
  );
}
