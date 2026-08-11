import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDoctor } from "@/lib/doctor-profile/get-doctor";
import { resolveDoctorTemplate } from "@/components/doctors/templates/registry";

export const dynamic = "force-dynamic";

type PageParams = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doctor = await getDoctor(slug);

  return { title: doctor?.full_name };
}

export default async function DoctorProfilePage({ params }: { params: Promise<PageParams> }) {
  const { locale, slug } = await params;
  const doctor = await getDoctor(slug);

  if (!doctor) {
    notFound();
  }

  // Called as a plain function, not rendered as JSX (<Template ... />) —
  // resolveDoctorTemplate's return value is a stable, module-level
  // function reference, but ESLint's react-hooks/static-components rule
  // can't see that through the indirection and flags the JSX form as
  // "creating a component during render." Both templates are already
  // async functions returning a ReactElement, so calling them directly
  // works the same either way.
  const renderTemplate = resolveDoctorTemplate(doctor.page_variant, doctor.custom_template_key);
  return renderTemplate({ locale, doctor });
}
