import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createTypedServiceRoleClient } from "./fixtures";

// Proves claim_email_outbox_batch's lease mechanics in isolation
// (PROJECT_SPEC.md's M7 section) — claim_email_outbox_batch never touches
// `appointments`, so these use minimal synthetic email_outbox rows rather
// than a full doctor/booking fixture. Robust to other tests/email/*.test.ts
// files' own pending rows possibly existing concurrently in the shared
// local DB (Vitest runs files in parallel by default): every assertion
// below filters the claimed set down to the row(s) this test itself
// created, rather than assuming an exact total count.

const admin = createTypedServiceRoleClient();
const createdRowIds: string[] = [];

afterEach(async () => {
  if (createdRowIds.length > 0) {
    await admin.from("email_outbox").delete().in("id", createdRowIds.splice(0));
  }
});

async function insertPendingRow(overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("email_outbox")
    .insert({
      to_email: "claim-lease-test@example.test",
      template: "appointment_confirmation",
      payload: { appointment_id: randomUUID() },
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`failed to insert email_outbox row: ${error.message}`);
  createdRowIds.push(data.id);
  return data;
}

describe("claim_email_outbox_batch (M7)", () => {
  it("two concurrent claims on one pending row: exactly one succeeds", async () => {
    const row = await insertPendingRow();

    const [resultA, resultB] = await Promise.all([
      admin.rpc("claim_email_outbox_batch", {
        p_limit: 100,
        p_max_attempts: 100,
        p_claim_token: randomUUID(),
      }),
      admin.rpc("claim_email_outbox_batch", {
        p_limit: 100,
        p_max_attempts: 100,
        p_claim_token: randomUUID(),
      }),
    ]);
    if (resultA.error) throw new Error(resultA.error.message);
    if (resultB.error) throw new Error(resultB.error.message);

    const claimedInA = resultA.data.some((claimedRow) => claimedRow.id === row.id);
    const claimedInB = resultB.data.some((claimedRow) => claimedRow.id === row.id);

    expect(claimedInA !== claimedInB).toBe(true); // exactly one of the two, never both, never neither
  });

  it("a stale processing row is reclaimed; a fresh one is left alone", async () => {
    const staleRow = await insertPendingRow();
    const freshRow = await insertPendingRow();

    const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    const freshTimestamp = new Date(Date.now() - 1 * 60 * 1000).toISOString(); // 1 min ago
    const oldClaimToken = randomUUID();

    await admin
      .from("email_outbox")
      .update({ status: "processing", processing_started_at: staleTimestamp, claim_token: oldClaimToken })
      .eq("id", staleRow.id);
    await admin
      .from("email_outbox")
      .update({ status: "processing", processing_started_at: freshTimestamp, claim_token: oldClaimToken })
      .eq("id", freshRow.id);

    const newClaimToken = randomUUID();
    const { data: claimed, error } = await admin.rpc("claim_email_outbox_batch", {
      p_limit: 100,
      p_max_attempts: 100,
      p_claim_token: newClaimToken,
      p_stale_after_minutes: 10,
    });
    if (error) throw new Error(error.message);

    expect(claimed.some((row) => row.id === staleRow.id)).toBe(true);
    expect(claimed.some((row) => row.id === freshRow.id)).toBe(false);

    const { data: staleAfter } = await admin
      .from("email_outbox")
      .select("claim_token, processing_started_at")
      .eq("id", staleRow.id)
      .single();
    expect(staleAfter?.claim_token).toBe(newClaimToken);
  });

  it("a finalize using a superseded claim_token affects 0 rows", async () => {
    const row = await insertPendingRow();

    const firstClaimToken = randomUUID();
    await admin.rpc("claim_email_outbox_batch", {
      p_limit: 100,
      p_max_attempts: 100,
      p_claim_token: firstClaimToken,
    });

    // Simulate a stale-lease reclaim by a second worker.
    await admin
      .from("email_outbox")
      .update({ processing_started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
      .eq("id", row.id);
    const secondClaimToken = randomUUID();
    await admin.rpc("claim_email_outbox_batch", {
      p_limit: 100,
      p_max_attempts: 100,
      p_claim_token: secondClaimToken,
      p_stale_after_minutes: 10,
    });

    // The first (now-superseded) worker tries to finalize using its own,
    // stale claim_token.
    const { data: finalized, error } = await admin
      .from("email_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("claim_token", firstClaimToken)
      .select("id");
    if (error) throw new Error(error.message);

    expect(finalized).toHaveLength(0);

    const { data: current } = await admin.from("email_outbox").select("claim_token, status").eq("id", row.id).single();
    expect(current?.claim_token).toBe(secondClaimToken);
    expect(current?.status).toBe("processing");
  });

  it("maxAttempts excludes a row from claiming once reached", async () => {
    const row = await insertPendingRow({ attempts: 4 });

    const { data: claimed, error } = await admin.rpc("claim_email_outbox_batch", {
      p_limit: 100,
      p_max_attempts: 5,
      p_claim_token: randomUUID(),
    });
    if (error) throw new Error(error.message);

    // attempts=4 < maxAttempts=5, so this row is still claimable (and gets
    // bumped to attempts=5 by the claim itself).
    expect(claimed.some((claimedRow) => claimedRow.id === row.id)).toBe(true);

    // A subsequent claim attempt at the same maxAttempts must now exclude it.
    const { data: claimedAgain, error: secondError } = await admin.rpc("claim_email_outbox_batch", {
      p_limit: 100,
      p_max_attempts: 5,
      p_claim_token: randomUUID(),
      p_stale_after_minutes: 0,
    });
    if (secondError) throw new Error(secondError.message);
    expect(claimedAgain.some((claimedRow) => claimedRow.id === row.id)).toBe(false);
  });
});
