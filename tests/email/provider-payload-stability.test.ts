import { afterAll, describe, expect, it } from "vitest";
import { cleanupUsers } from "../db/fixtures";
import {
  createTypedServiceRoleClient,
  setupDoctorWithHours,
  bookForEmailTest,
  createFakeEmailSender,
  LOCAL_DATE,
} from "./fixtures";
import { processEmailOutbox } from "@/lib/email/process-email-outbox";

// Directly answers the "byte-for-byte identical provider payload across
// retries" requirement (PROJECT_SPEC.md's M7 section) with a single
// whole-object equality assertion — deliberately not a field-by-field
// check, so a future field added to SendEmailInput without also being
// made retry-stable would fail this test instead of silently passing.

describe("provider payload stability across retries (M7)", () => {
  const admin = createTypedServiceRoleClient();
  const userIds: string[] = [];

  afterAll(async () => {
    await cleanupUsers(admin, userIds);
  });

  it("the full provider-call payload is byte-for-byte identical between a first attempt and a retry", async () => {
    const doctor = await setupDoctorWithHours(admin);
    userIds.push(doctor.user.id);
    await bookForEmailTest(admin, doctor, `${LOCAL_DATE}T09:00:00Z`);

    // First attempt: sender fails cleanly, leaving the row `pending` for
    // a retry (first_send_attempt_at and the minted token both persist).
    const { sender: firstSender, calls: firstCalls } = createFakeEmailSender({ failFirstNCalls: 1000 });
    await processEmailOutbox(admin, firstSender, { limit: 100, maxAttempts: 5 });
    expect(firstCalls).toHaveLength(1);

    // Retry: a fresh claim pass over the same still-pending row.
    const { sender: secondSender, calls: secondCalls } = createFakeEmailSender();
    await processEmailOutbox(admin, secondSender, { limit: 100, maxAttempts: 5 });
    expect(secondCalls).toHaveLength(1);

    // Single whole-object assertion — subject, html, text, to, from, and
    // idempotencyKey all included, not cherry-picked.
    expect(secondCalls[0]).toEqual(firstCalls[0]);
  });
});
