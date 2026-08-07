import { MapPin } from "lucide-react";
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
    <Card className="flex flex-col">
      <CardHeader className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-full text-base font-medium">
          {getInitials(doctor.fullName)}
        </div>
        <div className="min-w-0">
          <CardTitle className="truncate">{doctor.fullName}</CardTitle>
          {doctor.specialtyName ? (
            <Badge variant="secondary" className="mt-1.5 h-auto px-2 py-0.5 text-xs font-medium">
              {doctor.specialtyName}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4 pt-4">
        {doctor.city ? (
          <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <MapPin className="text-accent size-3.5 shrink-0" aria-hidden />
            {doctor.city}
          </div>
        ) : null}
        <Link
          href={`/doctors/${doctor.slug}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
        >
          {viewProfileLabel}
        </Link>
      </CardContent>
    </Card>
  );
}
