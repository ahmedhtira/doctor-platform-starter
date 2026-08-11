import { StandardDoctorPage } from "./standard-doctor-page";
import type { DoctorTemplateProps } from "./types";

/**
 * A minimal placeholder proving the registry/dispatch mechanism works
 * end to end — not real bespoke design, which is the platform admin's
 * own future work (per the requirements: "a custom-designed page/
 * template that I personally add to the codebase"). A real custom
 * template would replace this file's contents entirely; only the export
 * name/registry entry need to stay wired up.
 */
export async function DrAmiraPremiumTemplate(props: DoctorTemplateProps) {
  return (
    <div>
      <div className="bg-accent text-accent-foreground px-4 py-1.5 text-center text-xs font-medium">
        Custom template: dr-amira-premium
      </div>
      <StandardDoctorPage {...props} />
    </div>
  );
}
