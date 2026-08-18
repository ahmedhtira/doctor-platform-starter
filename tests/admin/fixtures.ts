import type { SupabaseClient } from "@supabase/supabase-js";
import { createSpecialty } from "../db/fixtures";
import type { EmailSender, SendEmailInput, SendEmailResult } from "@/lib/email/send-email";
import type { ProvisionDoctorInput } from "@/lib/admin/provision-doctor";

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

export const ADMIN_ACTOR_USER_ID = "00000000-0000-0000-0000-000000000001";
export const REDIRECT_TO = "http://127.0.0.1:3000/fr/auth/confirm";

export async function buildProvisionInput(
  admin: SupabaseClient,
  overrides: Partial<ProvisionDoctorInput> = {},
): Promise<ProvisionDoctorInput> {
  const specialtyId = overrides.specialtyId ?? (await createSpecialty(admin));
  return {
    adminActorUserId: ADMIN_ACTOR_USER_ID,
    email: `${unique("invited-doctor")}@example.test`,
    fullName: "Dr. Provisioned",
    specialtyId,
    slug: unique("dr-provisioned"),
    defaultLocale: "fr",
    timezone: "Africa/Tunis",
    pageVariant: "standard",
    customTemplateKey: null,
    clinic: {
      name: "Main clinic",
      address: "1 Test St",
      city: "Tunis",
      location_type: "clinic",
      timezone: "Africa/Tunis",
    },
    appointmentType: { name: "Consultation", durationMinutes: 30 },
    workingDays: [1, 2, 3, 4, 5],
    workingStartTime: "09:00",
    workingEndTime: "17:00",
    redirectTo: REDIRECT_TO,
    ...overrides,
  };
}

export type FakeSenderHandle = {
  sender: EmailSender;
  calls: SendEmailInput[];
  fail: boolean;
};

/**
 * Records every call so tests can assert the invite/reset email was sent
 * synchronously, in-request — never routed through email_outbox. Set
 * `.fail = true` to simulate a Resend-side failure and exercise
 * provisionDoctor's compensating rollback.
 */
export function createFakeSender(): FakeSenderHandle {
  const handle: FakeSenderHandle = {
    calls: [],
    fail: false,
    sender: async (input: SendEmailInput): Promise<SendEmailResult> => {
      handle.calls.push(input);
      if (handle.fail) {
        return { success: false, error: "simulated send failure" };
      }
      return { success: true, id: `fake-${handle.calls.length}` };
    },
  };
  return handle;
}
