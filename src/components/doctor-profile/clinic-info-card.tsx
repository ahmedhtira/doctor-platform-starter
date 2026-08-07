import { MapPin, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClinicInfoCard({
  clinic,
  phone,
  phoneLabel,
}: {
  clinic: { id: string; name: string; address: string };
  phone?: string | null;
  phoneLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{clinic.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex gap-2.5">
          <MapPin className="text-accent size-4 shrink-0 translate-y-0.5" aria-hidden />
          <p className="text-muted-foreground">{clinic.address}</p>
        </div>
        {phone ? (
          <div className="flex gap-2.5">
            <Phone className="text-accent size-4 shrink-0 translate-y-0.5" aria-hidden />
            <p className="text-muted-foreground">
              <span className="sr-only">{phoneLabel}: </span>
              {phone}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
