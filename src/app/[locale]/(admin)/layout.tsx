import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/admin/auth-context";
import { logoutAction } from "@/lib/dashboard/logout-action";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

// Optimistic gate only (redirect to /login if not the platform admin) —
// each page underneath still runs its own requirePlatformAdmin() call,
// same "layout + data-access-layer" model the (dashboard) layout already
// established (a layout check alone isn't sufficient, since layouts
// don't re-render on sibling navigation).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin();
  const t = await getTranslations("admin");

  return (
    <div className="flex min-h-svh">
      <aside className="bg-muted/30 flex w-56 shrink-0 flex-col justify-between border-e p-4">
        <nav className="flex flex-col gap-1 text-sm">
          <Link
            href="/admin"
            className="hover:bg-accent hover:text-accent-foreground rounded-md px-2 py-1.5 font-medium transition-colors"
          >
            {t("nav.doctors")}
          </Link>
        </nav>
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground truncate px-2 text-xs">{admin.email}</p>
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
