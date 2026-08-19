import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { AdminError } from "./admin-errors";

export async function setDoctorPublished(
  supabase: SupabaseClient<Database>,
  input: {
    doctorId: string;
    isPublished: boolean;
  },
): Promise<void> {
  const { data, error } = await supabase
    .from("doctors")
    .update({
      is_published: input.isPublished,
    })
    .eq("id", input.doctorId)
    .select("id")
    .maybeSingle();

  if (error) {
    // The database invariant refuses:
    // is_published=true while suspended_at/deleted_at is set.
    if (input.isPublished && error.code === "23514") {
      throw new AdminError(
        "VALIDATION_ERROR",
        "Suspended or deleted doctors cannot be published.",
      );
    }

    throw new AdminError("UNKNOWN", error.message);
  }

  if (!data) {
    throw new AdminError(
      "NOT_FOUND",
      "Doctor not found.",
    );
  }
}
