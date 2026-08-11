import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getTestSupabaseServiceRoleKey, getTestSupabaseUrl } from "../db/env";
import { cleanupUsers } from "../db/fixtures";
import { buildProvisionInput, createFakeSender } from "./fixtures";
import { provisionDoctor } from "@/lib/admin/provision-doctor";
import { sendAccountEmail } from "@/lib/email/send-account-email";
import { isPlatformAdminUserId } from "@/lib/admin/is-platform-admin";
import type { Database } from "@/lib/supabase/database.types";

// Directly proves the four security properties the user required for
// M10's invite/reset email architecture (PROJECT_SPEC.md's M10 section):
// the raw Supabase action link is a bearer credential and must never
// reach a table or a log line; it must be sent immediately, in-request,
// never via the once-daily email_outbox worker; a send failure must
// roll back everything provisionDoctor created; and only
// PLATFORM_ADMIN_USER_ID may provision/manage doctors.
//
// Server Actions (admin/actions.ts, forgot-password/actions.ts) are not
// imported directly here -- like every other Server Action in this
// codebase, they pull in "server-only"-guarded modules (next-intl/server,
// auth-context.ts) that only resolve under Next's own react-server build
// condition, not plain Vitest. Every existing test file in this repo
// exercises the underlying DI-core instead (provisionDoctor,
// sendAccountEmail, generateLink) -- this file follows the same
// convention, and isPlatformAdminUserId (the one pure, testable seam
// auth-context.ts and admin/actions.ts both key their authorization off
// of) for the identity property.

function createTypedServiceRoleClient(): SupabaseClient<Database> {
  return createClient<Database>(getTestSupabaseUrl(), getTestSupabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extractLink(text: string): string {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("no link found in rendered email text");
  return match[0];
}

describe("Account email security properties (M10)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("provisionDoctor: the raw invite action link never appears in doctors, audit_log, or email_outbox", async () => {
    const sender = createFakeSender();
    const input = await buildProvisionInput(admin);

    const result = await provisionDoctor(admin, sender.sender, input);
    userIds.push(result.authUserId);

    const actionLink = extractLink(sender.calls[0].text);
    expect(actionLink).toContain("/auth/v1/");

    const { data: doctorRow } = await admin.from("doctors").select("*").eq("id", result.doctor.id).single();
    expect(JSON.stringify(doctorRow)).not.toContain(actionLink);

    const { data: auditRows } = await admin.from("audit_log").select("*").eq("entity_id", result.doctor.id);
    expect(auditRows!.length).toBeGreaterThan(0);
    for (const row of auditRows!) {
      expect(JSON.stringify(row)).not.toContain(actionLink);
      expect(JSON.stringify(row)).not.toContain("token");
    }

    const { data: outboxRows } = await admin.from("email_outbox").select("*").eq("to_email", input.email);
    expect(outboxRows).toHaveLength(0);
  });

  it("provisionDoctor: the invite email is sent synchronously, in the same call -- no outbox drain needed", async () => {
    const sender = createFakeSender();
    const input = await buildProvisionInput(admin);

    const result = await provisionDoctor(admin, sender.sender, input);
    userIds.push(result.authUserId);

    // The assertion is what already happened by the time `await` above
    // resolved: exactly one send, with no intervening call to
    // processEmailOutbox or any other worker.
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].to).toBe(input.email);
  });

  it("password reset: generateLink + sendAccountEmail deliver the recovery link immediately and never persist it", async () => {
    // Mirrors requestPasswordResetAction's exact mechanism (the Server
    // Action itself just wires this to the request locale/redirect URL).
    const sender = createFakeSender();
    const input = await buildProvisionInput(admin);
    const invited = await provisionDoctor(admin, createFakeSender().sender, input);
    userIds.push(invited.authUserId);

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: input.email,
      options: { redirectTo: "http://127.0.0.1:3000/fr/auth/confirm" },
    });
    expect(linkError).toBeNull();
    const actionLink = linkData!.properties!.action_link;

    const sendResult = await sendAccountEmail(sender.sender, {
      template: "password_reset",
      locale: "fr",
      to: input.email,
      actionLink,
    });
    expect(sendResult.success).toBe(true);
    expect(sender.calls).toHaveLength(1);
    expect(extractLink(sender.calls[0].text)).toBe(actionLink);

    const { data: doctorRow } = await admin.from("doctors").select("*").eq("id", invited.doctor.id).single();
    expect(JSON.stringify(doctorRow)).not.toContain(actionLink);

    const { data: outboxRows } = await admin.from("email_outbox").select("*").eq("to_email", input.email);
    expect(outboxRows).toHaveLength(0);
  });

  it("provisionDoctor: a failed send rolls back the doctor and auth account, leaving no trace", async () => {
    const sender = createFakeSender();
    sender.fail = true;
    const input = await buildProvisionInput(admin);

    await expect(provisionDoctor(admin, sender.sender, input)).rejects.toMatchObject({
      code: "EMAIL_SEND_FAILED",
    });

    const { data: leftoverDoctor } = await admin.from("doctors").select("id").eq("slug", input.slug).maybeSingle();
    expect(leftoverDoctor).toBeNull();

    const { data: usersAfterFailure } = await admin.auth.admin.listUsers();
    expect(usersAfterFailure.users.find((u) => u.email === input.email)).toBeUndefined();
  });

  it("isPlatformAdminUserId collapses a wrong-but-well-formed user id and an unauthenticated (null) caller to the same rejection", () => {
    const adminId = "aaaaaaaa-1111-1111-1111-111111111111";
    const wrongButRealId = "bbbbbbbb-2222-2222-2222-222222222222";

    expect(isPlatformAdminUserId(wrongButRealId, adminId)).toBe(false);
    expect(isPlatformAdminUserId(null, adminId)).toBe(false);
    expect(isPlatformAdminUserId(wrongButRealId, adminId)).toBe(isPlatformAdminUserId(null, adminId));
  });
});
