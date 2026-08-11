import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/admin/auth-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EditDoctorForm } from "@/components/admin/edit-doctor-form";

export default async function AdminEditDoctorPage({
  params,
}: {
  params: Promise<{ locale: string; doctorId: string }>;
}) {
  await requirePlatformAdmin();
  const { locale, doctorId } = await params;

  const supabase = createServiceRoleClient();
  const [{ data: doctor, error: doctorError }, { data: specialties, error: specialtiesError }] =
    await Promise.all([
      supabase.from("doctors").select("*").eq("id", doctorId).maybeSingle(),
      supabase.from("specialties").select("id, name_fr, name_ar").order("name_fr"),
    ]);

  if (doctorError) throw new Error(`Failed to load doctor: ${doctorError.message}`);
  if (specialtiesError) throw new Error(`Failed to load specialties: ${specialtiesError.message}`);
  if (!doctor) notFound();

  const t = await getTranslations("admin");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-medium">{t("editDoctorTitle", { name: doctor.full_name })}</h1>
      <EditDoctorForm doctor={doctor} specialties={specialties} locale={locale} />
    </div>
  );
}
