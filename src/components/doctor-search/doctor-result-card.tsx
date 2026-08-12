import { ArrowRight, MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/doctor-display";

export type DoctorSearchResult = {
  slug: string;
  fullName: string;
  specialtyName?: string | null;
  city?: string | null;
};

/**
 * One search result. `city`/`specialtyName` are optional so this also
 * degrades gracefully for a doctor with no clinic yet or an unpublished
 * specialty edge case — it just omits that line rather than showing
 * "null".
 */
export function DoctorResultCard({
  doctor,
  viewProfileLabel,
}: {
  doctor: DoctorSearchResult;
  viewProfileLabel: string;
}) {
  return (
    <Card className="flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader className="flex items-center gap-4 px-5 pt-1">
        <div className="bg-primary text-primary-foreground ring-primary/10 flex size-14 shrink-0 items-center justify-center rounded-2xl text-base font-semibold ring-4">
          {getInitials(doctor.fullName)}
        </div>
        <div className="min-w-0">
          <CardTitle className="truncate text-lg">{doctor.fullName}</CardTitle>
          {doctor.specialtyName ? (
            <Badge variant="secondary" className="mt-1.5 h-auto px-2 py-0.5 text-xs font-medium">
              {doctor.specialtyName}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4 px-5 pt-4">
        {doctor.city ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <MapPin className="text-accent size-3.5 shrink-0" aria-hidden />
            {doctor.city}
          </div>
        ) : null}
        <Link
          href={`/doctors/${doctor.slug}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "group/link h-10 w-full gap-2",
          )}
        >
          {viewProfileLabel}
          <ArrowRight
            className="size-4 transition-transform group-hover/link:translate-x-0.5 rtl:rotate-180 rtl:group-hover/link:-translate-x-0.5"
            aria-hidden
          />
        </Link>
      </CardContent>
    </Card>
  );
}
