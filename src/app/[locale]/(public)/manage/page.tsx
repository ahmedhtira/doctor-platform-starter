import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getManagedAppointment } from "@/lib/booking/get-managed-appointment";
import { hashSecret } from "@/lib/booking/crypto-secret";
import { MANAGE_SESSION_COOKIE_NAME } from "@/lib/booking/manage-session-cookie";
import { ManageGate } from "@/components/manage/manage-gate";

// Never indexed, never cached — see the privacy-header block in
// next.config.ts (Cache-Control/Referrer-Policy/X-Robots-Tag) and
// PROJECT_SPEC.md "Patient self-service (M5)". No analytics/tag-manager
// script may ever be added to this route or a shared layout it inherits
// from — the management experience carries privacy-sensitive appointment
// data reachable by anyone holding the link.
export const dynamic = "force-dynamic";

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "manage" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function ManagePage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;

  const cookieStore = await cookies();
  const rawSecret = cookieStore.get(MANAGE_SESSION_COOKIE_NAME)?.value;

  const appointment = rawSecret
    ? await getManagedAppointment(createServiceRoleClient(), hashSecret(rawSecret))
    : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 lg:py-16">
      <ManageGate appointment={appointment} locale={locale} />
    </div>
  );
}
