import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { DoctorStatusActions } from "./doctor-status-actions";
import type { AdminDoctorListItem } from "@/lib/admin/list-doctors-for-admin";

export async function DoctorListTable({
  doctors,
  locale,
}: {
  doctors: AdminDoctorListItem[];
  locale: string;
}) {
  const t = await getTranslations("admin");

  if (doctors.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("doctorsEmpty")}</p>;
  }

  return (
    <ul className="divide-border divide-y">
      {doctors.map((doctor) => (
        <li key={doctor.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-medium">{doctor.fullName}</p>
            <p className="text-muted-foreground text-sm">
              {locale === "ar" ? doctor.specialtyNameAr : doctor.specialtyNameFr} · /{locale}/doctors/{doctor.slug}
            </p>
            <div className="mt-1 flex gap-1.5">
              {doctor.isDeleted ? (
                <Badge variant="destructive">{t("statusDeleted")}</Badge>
              ) : doctor.isSuspended ? (
                <Badge variant="destructive">{t("statusSuspended")}</Badge>
              ) : doctor.isPublished ? (
                <Badge>{t("statusPublished")}</Badge>
              ) : (
                <Badge variant="secondary">{t("statusUnpublished")}</Badge>
              )}
              {doctor.pageVariant === "custom" ? (
                <Badge variant="secondary">{t("statusCustomPage")}</Badge>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!doctor.isDeleted ? (
              <Link
                href={`/admin/${doctor.id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t("editAction")}
              </Link>
            ) : null}
            <DoctorStatusActions doctor={doctor} />
          </div>
        </li>
      ))}
    </ul>
  );
}
