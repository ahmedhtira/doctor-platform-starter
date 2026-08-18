import { getTranslations } from "next-intl/server";
import { ProfileHero } from "@/components/doctor-profile/profile-hero";
import { ClinicInfoCard } from "@/components/doctor-profile/clinic-info-card";
import { InfoListSection, type CredentialItem } from "@/components/doctor-profile/info-list-section";
import { BookingWidget } from "@/components/booking/booking-widget";
import type { DoctorTemplateProps } from "./types";

/**
 * Everything from <ProfileHero> down in the original
 * doctors/[slug]/page.tsx, relocated unchanged — the default template,
 * and the registry's fallback when a custom_template_key is missing,
 * unregistered, or page_variant isn't "custom". See
 * PROJECT_SPEC.md's M10 section.
 */
export async function StandardDoctorPage({ locale, doctor }: DoctorTemplateProps) {
  const t = await getTranslations("doctorProfile");
  const specialtyName = locale === "ar" ? doctor.specialties?.name_ar : doctor.specialties?.name_fr;

  const qualifications: CredentialItem[] = doctor.doctor_qualifications.map((qualification) => ({
    id: qualification.id,
    title: qualification.title,
    subtitle: qualification.institution,
    year: qualification.year_obtained,
  }));

  const publications: CredentialItem[] = doctor.doctor_publications.map((publication) => ({
    id: publication.id,
    title: publication.title,
    subtitle: publication.publication_name,
    year: publication.published_year,
    href: publication.url,
    hrefLabel: t("readMore"),
  }));

  const books: CredentialItem[] = doctor.doctor_books.map((book) => ({
    id: book.id,
    title: book.title,
    subtitle: book.publisher,
    year: book.published_year,
  }));

  const mediaAppearances: CredentialItem[] = doctor.doctor_media_appearances.map((appearance) => ({
    id: appearance.id,
    title: appearance.title,
    subtitle: appearance.outlet,
    href: appearance.url,
    hrefLabel: t("readMore"),
  }));

  return (
    <div>
      <ProfileHero
        fullName={doctor.full_name}
        specialtyName={specialtyName}
        photoPath={doctor.photo_path}
      />

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_320px] lg:gap-14 lg:py-16">
        <div className="order-2 space-y-10 lg:order-1">
          {doctor.clinics.length > 0 && doctor.appointment_types.length > 0 ? (
            <section>
              <BookingWidget
                doctorId={doctor.id}
                doctorName={doctor.full_name}
                clinics={doctor.clinics}
                appointmentTypes={doctor.appointment_types.map((type) => ({
                  id: type.id,
                  name: type.name,
                  durationMinutes: type.duration_minutes,
                }))}
                locale={locale}
              />
            </section>
          ) : null}

          {doctor.bio ? (
            <section>
              <h2 className="font-heading text-xl font-medium">{t("biographyTitle")}</h2>
              <p className="text-muted-foreground mt-4 leading-relaxed whitespace-pre-line">
                {doctor.bio}
              </p>
            </section>
          ) : null}

          <InfoListSection title={t("qualificationsTitle")} items={qualifications} />
          <InfoListSection title={t("publicationsTitle")} items={publications} />
          <InfoListSection title={t("booksTitle")} items={books} />
          <InfoListSection title={t("mediaAppearancesTitle")} items={mediaAppearances} />
        </div>

        {doctor.clinics.length > 0 ? (
          <aside className="order-1 space-y-4 lg:order-2">
            <h2 className="font-heading text-xl font-medium">{t("clinicTitle")}</h2>
            {doctor.clinics.map((clinic) => (
              <ClinicInfoCard
                key={clinic.id}
                clinic={clinic}
                phone={doctor.phone}
                phoneLabel={t("phoneLabel")}
              />
            ))}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
