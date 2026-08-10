import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Tests only the M9 Route Handler's auth guard and delegation shape — not
// email sending itself, which tests/email/process-email-outbox.test.ts
// already covers end-to-end against a real local Supabase instance. All
// three dependencies are mocked so this suite needs no DB/Resend
// credentials and can't accidentally attempt a real send.
const { processEmailOutboxMock, createServiceRoleClientMock, createResendSenderMock } = vi.hoisted(
  () => ({
    processEmailOutboxMock: vi.fn(),
    createServiceRoleClientMock: vi.fn(() => "fake-supabase-client"),
    createResendSenderMock: vi.fn(() => "fake-sender"),
  }),
);

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("@/lib/email/resend-sender", () => ({
  createResendSender: createResendSenderMock,
}));
vi.mock("@/lib/email/process-email-outbox", () => ({
  processEmailOutbox: processEmailOutboxMock,
}));

import { GET } from "@/app/api/cron/process-email-outbox/route";

const ENDPOINT = "http://localhost/api/cron/process-email-outbox";

describe("GET /api/cron/process-email-outbox (M9)", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    processEmailOutboxMock.mockReset();
    createServiceRoleClientMock.mockClear();
    createResendSenderMock.mockClear();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await GET(new Request(ENDPOINT));
    expect(response.status).toBe(401);
    expect(processEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong secret", async () => {
    const response = await GET(
      new Request(ENDPOINT, { headers: { authorization: "Bearer wrong-secret" } }),
    );
    expect(response.status).toBe(401);
    expect(processEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(
      new Request(ENDPOINT, { headers: { authorization: "Bearer anything" } }),
    );
    expect(response.status).toBe(401);
    expect(processEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("processes the outbox and returns its summary when the secret matches", async () => {
    processEmailOutboxMock.mockResolvedValue({ claimed: 3, sent: 2, failed: 1 });

    const response = await GET(
      new Request(ENDPOINT, { headers: { authorization: "Bearer test-cron-secret" } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ claimed: 3, sent: 2, failed: 1 });
    expect(createServiceRoleClientMock).toHaveBeenCalledTimes(1);
    expect(createResendSenderMock).toHaveBeenCalledTimes(1);
    expect(processEmailOutboxMock).toHaveBeenCalledWith("fake-supabase-client", "fake-sender");
  });
});
