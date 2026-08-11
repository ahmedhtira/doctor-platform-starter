import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/admin/auth-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listDoctorsForAdmin } from "@/lib/admin/list-doctors-for-admin";
import { DoctorListTable } from "@/components/admin/doctor-list-table";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function AdminDoctorsPage({ params }: { params: Promise<{ locale: string }> }) {
  // The secure check — the layout's own call is optimistic only, per the
  // established layout+DAL two-gate model.
  await requirePlatformAdmin();
  const { locale } = await params;

  const supabase = createServiceRoleClient();
  const doctors = await listDoctorsForAdmin(supabase);
  const t = await getTranslations("admin");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium">{t("doctorsTitle")}</h1>
        <Link href="/admin/new" className={buttonVariants({ variant: "default" })}>
          {t("addDoctorAction")}
        </Link>
      </div>
      <DoctorListTable doctors={doctors} locale={locale} />
    </div>
  );
}
