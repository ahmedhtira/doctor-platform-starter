import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/admin/auth-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listSpecialties } from "@/lib/specialties/list-specialties";
import { CreateDoctorForm } from "@/components/admin/create-doctor-form";

export default async function AdminNewDoctorPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;

  const supabase = createServiceRoleClient();
  const specialties = await listSpecialties(supabase);

  const t = await getTranslations("admin");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-medium">{t("addDoctorTitle")}</h1>
      <CreateDoctorForm specialties={specialties} defaultLocale={locale} />
    </div>
  );
}
