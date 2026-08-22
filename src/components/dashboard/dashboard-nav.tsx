"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarDays, CalendarRange, Clock3 } from "lucide-react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { buildDashboardHref } from "@/lib/dashboard/dashboard-links";
import type { StaffDoctorSummary } from "@/lib/dashboard/auth-context";
import { InstallDoctorAppButton } from "@/components/dashboard/install-doctor-app-button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { key: "today", path: "/dashboard", icon: CalendarDays },
  { key: "calendar", path: "/dashboard/calendar", icon: CalendarRange },
  { key: "availability", path: "/dashboard/availability", icon: Clock3 },
] as const;

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

  // The dashboard is only three primary screens. Warm all three RSC routes
  // as soon as the shell mounts so moving between Today / Calendar /
  // Availability usually uses prefetched data instead of waiting for a
  // navigation-time round trip. Re-run only when the selected doctor changes.
  useEffect(() => {
    for (const item of NAV_ITEMS) {
      router.prefetch(buildDashboardHref(item.path, { doctorId }));
    }
  }, [doctorId, router]);

  return (
    <nav className="flex flex-col gap-3 text-sm">
      <div className="flex min-w-0 gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;

          return (
            <Link
              key={item.key}
              href={buildDashboardHref(item.path, { doctorId })}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 font-medium transition-colors",
                pathname === item.path
                  ? "bg-accent text-accent-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(item.key)}
            </Link>
          );
        })}
        <span className="text-muted-foreground/50 hidden min-h-10 items-center px-3 py-2 lg:flex">
          {t("profile")}
        </span>
        <span className="text-muted-foreground/50 hidden min-h-10 items-center px-3 py-2 lg:flex">
          {t("staff")}
        </span>
        <InstallDoctorAppButton
          actionLabel={t("installApp")}
          description={t("installAppDescription")}
          openingLabel={t("installAppOpening")}
        />
      </div>

      {doctors.length > 1 ? (
        <div className="flex max-w-sm flex-col gap-1.5 lg:mt-3">
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
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 mx-2 h-10 rounded-lg border px-2.5 text-sm shadow-xs transition-all outline-none focus-visible:ring-3"
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
