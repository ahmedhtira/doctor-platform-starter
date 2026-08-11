import type { PublicDoctorProfile } from "@/lib/doctor-profile/get-doctor";

/**
 * Templates receive the raw fetched shape (not a pre-derived
 * CredentialItem[] or similar) and do their own translation/mapping
 * themselves — the minimal extraction from the original page.tsx (move
 * the JSX, change nothing about how it works), not a new abstraction
 * layer a future custom template would have to conform to.
 */
export type DoctorTemplateProps = {
  locale: string;
  doctor: PublicDoctorProfile;
};

export type DoctorTemplateComponent = (props: DoctorTemplateProps) => Promise<React.ReactElement>;
