import { getTranslations } from "next-intl/server";
import type { PublicDoctorProfile } from "@/lib/doctor-profile/get-doctor";
import { phoneHref } from "@/lib/doctor-profile/list-sos-doctors";
import { buttonVariants } from "@/components/ui/button";

export async function DoctorServiceNotice({
  doctor,
  locale,
}: {
  doctor: PublicDoctorProfile;
  locale: string;
}) {
  const t = await getTranslations("doctorServices");
  const sosContact = phoneHref(doctor.sos_phone);
  const bookingContact = phoneHref(doctor.phone);
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-TN" : "fr-TN", {
    style: "currency",
    currency: "TND",
  }).format((doctor.payment_amount_millimes ?? 0) / 1000);
  return (
    <div className="space-y-4">
      {doctor.sos_enabled ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-950">
          <h2 className="font-semibold">{t("sosTitle")}</h2>
          <p className="mt-2 text-sm">{t("publicSosHint")}</p>
          {doctor.sos_area ? <p className="mt-2 text-sm">{doctor.sos_area}</p> : null}
          {sosContact ? (
            <a className={buttonVariants({ className: "mt-4" })} href={sosContact}>
              {t("call")} <bdi>{doctor.sos_phone}</bdi>
            </a>
          ) : null}
        </section>
      ) : null}
      {doctor.payment_required ? (
        <section className="bg-card space-y-3 rounded-xl border p-5">
          <h2 className="font-semibold">
            {t(doctor.payment_mode === "full" ? "publicFull" : "publicDeposit", { amount })}
          </h2>
          <p className="text-muted-foreground text-sm">{t("publicPaymentNotice")}</p>
          {doctor.payment_terms ? (
            <div className="text-sm">
              <h3 className="font-medium">{t("terms")}</h3>
              <p className="mt-1 whitespace-pre-line">{doctor.payment_terms}</p>
            </div>
          ) : null}
          {bookingContact ? (
            <a className={buttonVariants({ variant: "outline" })} href={bookingContact}>
              {t("contactPractice")}
            </a>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
