import type { ReactNode } from "react";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { getAuthenticatedUser, getStaffedDoctors } from "@/lib/dashboard/auth-context";
import { logoutAction } from "@/lib/dashboard/logout-action";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";

// Optimistic gate only (redirect to /login if unauthenticated/unstaffed) —
// each page underneath still runs its own requireDoctorContext() secure
// check, per the Next.js auth guide's warning that a layout check alone
// isn't sufficient (layouts don't re-render on sibling navigation). See
// PROJECT_SPEC.md's "layout + data-access-layer + RLS" model.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const user = await getAuthenticatedUser();
  if (!user) {
    return redirect({ href: "/login", locale });
  }

  const doctors = await getStaffedDoctors(user.id);
  if (doctors.length === 0) {
    return redirect({ href: "/login", locale });
  }

  const t = await getTranslations("dashboard");

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <aside className="bg-muted/35 w-full shrink-0 border-b p-3 lg:flex lg:w-60 lg:flex-col lg:justify-between lg:border-e lg:border-b-0 lg:p-4">
        <div>
          <div className="flex items-center justify-between gap-3 lg:block">
            <Link href="/" aria-label="Dewini" className="inline-flex rounded-md">
              <Image
                src="/dewini-logo.png"
                alt="Dewini"
                width={1266}
                height={552}
                priority
                className="h-8 w-auto lg:h-9"
              />
            </Link>
            <div className="flex items-center gap-2 lg:hidden">
              <LocaleSwitcher />
              <form action={logoutAction}>
                <Button type="submit" variant="outline" size="sm" className="h-9">
                  {t("logout")}
                </Button>
              </form>
            </div>
          </div>
          <p className="text-muted-foreground mt-3 hidden px-2 text-xs font-semibold tracking-[0.12em] uppercase lg:block">
            {t("workspace")}
          </p>
          <div className="mt-3 lg:mt-2">
            <DashboardNav doctors={doctors} selectedDoctorId={doctors[0].id} />
          </div>
        </div>
        <div className="hidden flex-col gap-3 lg:flex">
          <LocaleSwitcher />
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="h-10 w-full">
              {t("logout")}
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
