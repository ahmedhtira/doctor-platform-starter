import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchAvailableSlots, type FetchAvailableSlotsParams } from "./fetch-availability-data";
import type { AvailableSlot } from "./compute-available-slots";

/**
 * The availability engine's production entry point — what a future
 * booking UI (M4+) calls. Not used anywhere yet ("do not implement
 * booking UI yet" — M3 scope is the engine itself). Thin on purpose: all
 * the actual logic lives in fetch-availability-data.ts/
 * compute-available-slots.ts, which are deliberately unguarded so they
 * stay testable from Vitest.
 */
export async function getAvailableSlots(params: FetchAvailableSlotsParams): Promise<AvailableSlot[]> {
  const supabase = createServiceRoleClient();
  return fetchAvailableSlots(supabase, params);
}
