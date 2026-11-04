import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/admin/auth-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { listSpecialties } from "@/lib/specialties/list-specialties";
import { EditDoctorForm } from "@/components/admin/edit-doctor-form";

export default async function AdminEditDoctorPage({
  params,
}: {
  params: Promise<{ locale: string; doctorId: string }>;
}) {
  await requirePlatformAdmin();
  const { locale, doctorId } = await params;

  const supabase = createServiceRoleClient();
  const [
    { data: doctor, error: doctorError },
    specialties,
    { data: account, error: accountError },
  ] = await Promise.all([
    supabase.from("doctors").select("*").eq("id", doctorId).maybeSingle(),
    listSpecialties(supabase),
    supabase
      .from("doctor_payment_accounts")
      .select("recipient_name, provider_name, account_reference")
      .eq("doctor_id", doctorId)
      .maybeSingle(),
  ]);

  if (doctorError) throw new Error(`Failed to load doctor: ${doctorError.message}`);
  if (!doctor) notFound();
  if (accountError) throw new Error("Failed to load payment settings.");

  const t = await getTranslations("admin");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-heading text-2xl font-medium">
        {t("editDoctorTitle", { name: doctor.full_name })}
      </h1>
      <EditDoctorForm
        services={{
          sosEnabled: doctor.sos_enabled,
          sosPhone: doctor.sos_phone ?? "",
          sosArea: doctor.sos_area ?? "",
          paymentRequired: doctor.payment_required,
          paymentMode: doctor.payment_mode === "full" ? "full" : "deposit",
          paymentAmount:
            doctor.payment_amount_millimes == null
              ? ""
              : (doctor.payment_amount_millimes / 1000).toFixed(3),
          paymentTerms: doctor.payment_terms ?? "",
          recipientName: account?.recipient_name ?? "",
          providerName: account?.provider_name ?? "",
          accountReference: account?.account_reference ?? "",
        }}
        doctor={doctor}
        specialties={specialties}
        locale={locale}
      />
    </div>
  );
}
