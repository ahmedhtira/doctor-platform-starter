import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/admin/auth-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CreateDoctorForm } from "@/components/admin/create-doctor-form";

export default async function AdminNewDoctorPage({ params }: { params: Promise<{ locale: string }> }) {
  await requirePlatformAdmin();
  const { locale } = await params;

  const supabase = createServiceRoleClient();
  const { data: specialties, error } = await supabase
    .from("specialties")
    .select("id, name_fr, name_ar")
    .order("name_fr");
  if (error) {
    throw new Error(`Failed to load specialties: ${error.message}`);
  }

  const t = await getTranslations("admin");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-medium">{t("addDoctorTitle")}</h1>
      <CreateDoctorForm specialties={specialties} defaultLocale={locale} />
    </div>
  );
}
