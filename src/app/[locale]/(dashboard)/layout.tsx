import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

// Placeholder shell only. The real auth guard (server-side session check +
// requireDoctorContext() at the data-access layer + RLS) is built in M6 —
// see the project plan, §5 and correction §2.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard.nav");
  const items = ["today", "calendar", "availability", "profile", "staff"] as const;

  return (
    <div className="flex min-h-svh">
      <aside className="bg-muted/30 w-56 shrink-0 border-e p-4">
        <nav className="flex flex-col gap-2 text-sm">
          {items.map((item) => (
            <span key={item} className="text-muted-foreground">
              {t(item)}
            </span>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
