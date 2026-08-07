import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/doctor-display";

/**
 * The banded header every doctor profile opens with. Kept deliberately
 * minimal (name, specialty, monogram) so a future custom doctor page can
 * reuse it as-is or swap in a real photo without restructuring anything
 * downstream.
 */
export function ProfileHero({
  fullName,
  specialtyName,
}: {
  fullName: string;
  specialtyName?: string | null;
}) {
  return (
    <div className="from-primary/12 via-primary/5 border-border/70 relative overflow-hidden border-b bg-gradient-to-b to-transparent">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 px-4 py-14 sm:flex-row sm:items-center sm:px-6 sm:py-16">
        <div className="bg-primary text-primary-foreground ring-background flex size-20 shrink-0 items-center justify-center rounded-full text-2xl font-medium ring-4 sm:size-24 sm:text-3xl">
          {getInitials(fullName)}
        </div>
        <div>
          <h1 className="font-heading text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            {fullName}
          </h1>
          {specialtyName ? (
            <Badge variant="secondary" className="mt-3 h-auto px-3 py-1 text-sm font-medium">
              {specialtyName}
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}
