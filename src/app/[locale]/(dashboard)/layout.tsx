import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { getAuthenticatedUser, getStaffedDoctors } from "@/lib/dashboard/auth-context";
import { logoutAction } from "@/lib/dashboard/logout-action";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { redirect } from "@/i18n/navigation";

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
    <div className="flex min-h-svh">
      <aside className="bg-muted/30 flex w-56 shrink-0 flex-col justify-between border-e p-4">
        <DashboardNav doctors={doctors} selectedDoctorId={doctors[0].id} />
        <div className="flex flex-col gap-3">
          <LocaleSwitcher />
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="w-full">
              {t("logout")}
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
