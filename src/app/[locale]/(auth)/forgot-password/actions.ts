"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createResendSender } from "@/lib/email/resend-sender";
import { sendAccountEmail } from "@/lib/email/send-account-email";
import { getAppUrl } from "@/lib/email/env";

// Server Action — the only place client code touches password recovery.
// Same non-enumeration discipline loginAction already established for
// this app's staff auth: the caller always sees the identical generic
// outcome, whether the email matched a real account or not, and whether
// the send itself succeeded or not. A genuine failure is only visible
// server-side (console.error), never differently reflected in the
// response — distinguishing the two in the response would itself leak
// which case applied.

const requestInputSchema = z.object({ email: z.email() });

export type RequestPasswordResetResult = { success: true };

export async function requestPasswordResetAction(input: unknown): Promise<RequestPasswordResetResult> {
  const parsed = requestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: true };
  }

  try {
    const supabase = createServiceRoleClient();
    const locale = await getLocale();
    const redirectTo = `${getAppUrl()}/${locale}/auth/confirm`;

    const { data, error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
      options: { redirectTo },
    });

    if (!error && data.properties?.hashed_token) {
      const actionLink =
        `${redirectTo}?token_hash=${encodeURIComponent(
          data.properties.hashed_token,
        )}&type=recovery`;

      const sendResult = await sendAccountEmail(createResendSender(), {
        template: "password_reset",
        locale,
        to: parsed.data.email,
        actionLink,
      });
      if (!sendResult.success) {
        console.error("requestPasswordResetAction: send failed", sendResult.error);
      }
    }
  } catch (error) {
    console.error("requestPasswordResetAction: unexpected error", error);
  }

  return { success: true };
}
