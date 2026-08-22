import { describe, expect, it } from "vitest";
import { classifyManageActionError } from "@/lib/booking/manage-errors";

describe("classifyManageActionError", () => {
  it("classifies the appointment-start cutoff separately", () => {
    expect(classifyManageActionError("55003")).toBe("APPOINTMENT_STARTED");
  });

  it("keeps existing schedule and overlap classifications unchanged", () => {
    expect(classifyManageActionError("55001")).toBe("SCHEDULE_CHANGED");
    expect(classifyManageActionError("23P01")).toBe("SLOT_UNAVAILABLE");
  });
});
