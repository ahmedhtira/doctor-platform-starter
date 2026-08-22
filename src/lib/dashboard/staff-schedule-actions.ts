import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ManageError, classifyManageActionError } from "@/lib/booking/manage-errors";

export type StaffCreatedAppointment = Database["public"]["Tables"]["appointments"]["Row"];
export type StaffUpdatedAppointment = Database["public"]["Tables"]["appointments"]["Row"];

export type StaffDelayAffectedAppointment = {
  appointment_id: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string | null;
  old_starts_at: string;
  old_ends_at: string;
  new_starts_at: string;
  new_ends_at: string;
  needs_contact: boolean;
};

export type StaffDelayPlan = {
  appointment_id: string;
  delay_minutes: number;
  old_ends_at: string;
  new_ends_at: string;
  affected_count: number;
  affected: StaffDelayAffectedAppointment[];
};

type RpcError = { code?: string; message: string };
type UnsafeRpcResult<T> = Promise<{ data: T | null; error: RpcError | null }>;

type UnsafeRpc = (functionName: string, args: Record<string, unknown>) => UnsafeRpcResult<unknown>;

function rpcClient(supabase: SupabaseClient<Database>): UnsafeRpc {
  // These RPCs are introduced by launch migrations before the generated
  // Supabase TypeScript file is regenerated. Keep the escape hatch tightly
  // scoped here rather than weakening types at every caller.
  return supabase.rpc.bind(supabase) as unknown as UnsafeRpc;
}

function throwRpcError(error: RpcError): never {
  throw new ManageError(classifyManageActionError(error.code), error.message);
}

export async function createStaffAppointment(
  supabase: SupabaseClient<Database>,
  input: {
    doctorId: string;
    clinicId: string;
    appointmentTypeId: string;
    startsAt: string;
    patientName: string;
    patientPhone: string;
    patientEmail: string | null;
    notes: string | null;
    actorUserId: string;
  },
): Promise<StaffCreatedAppointment> {
  const { data, error } = (await rpcClient(supabase)("create_staff_appointment", {
    p_doctor_id: input.doctorId,
    p_clinic_id: input.clinicId,
    p_appointment_type_id: input.appointmentTypeId,
    p_starts_at: input.startsAt,
    p_patient_name: input.patientName,
    p_patient_phone: input.patientPhone,
    p_patient_email: input.patientEmail,
    p_notes: input.notes,
    p_actor_user_id: input.actorUserId,
  })) as { data: StaffCreatedAppointment | null; error: RpcError | null };

  if (error) throwRpcError(error);
  if (!data) {
    throw new ManageError("UNKNOWN", "Manual appointment was not returned by the database.");
  }
  return data;
}

export async function updateStaffAppointmentDetails(
  supabase: SupabaseClient<Database>,
  input: {
    appointmentId: string;
    appointmentTypeId: string;
    patientName: string;
    patientPhone: string;
    patientEmail: string | null;
    notes: string | null;
    actorUserId: string;
  },
): Promise<StaffUpdatedAppointment> {
  const { data, error } = (await rpcClient(supabase)("update_staff_appointment_details", {
    p_appointment_id: input.appointmentId,
    p_appointment_type_id: input.appointmentTypeId,
    p_patient_name: input.patientName,
    p_patient_phone: input.patientPhone,
    p_patient_email: input.patientEmail,
    p_notes: input.notes,
    p_actor_user_id: input.actorUserId,
  })) as { data: StaffUpdatedAppointment | null; error: RpcError | null };

  if (error) throwRpcError(error);
  if (!data) {
    throw new ManageError("UNKNOWN", "Updated appointment was not returned by the database.");
  }
  return data;
}

export async function previewStaffAppointmentDelay(
  supabase: SupabaseClient<Database>,
  input: { appointmentId: string; delayMinutes: number; actorUserId: string },
): Promise<StaffDelayPlan> {
  const { data, error } = (await rpcClient(supabase)("preview_staff_appointment_delay", {
    p_appointment_id: input.appointmentId,
    p_delay_minutes: input.delayMinutes,
    p_actor_user_id: input.actorUserId,
  })) as { data: StaffDelayPlan | null; error: RpcError | null };

  if (error) throwRpcError(error);
  if (!data) {
    throw new ManageError("UNKNOWN", "Delay preview was not returned by the database.");
  }
  return data;
}

export async function applyStaffAppointmentDelay(
  supabase: SupabaseClient<Database>,
  input: { appointmentId: string; delayMinutes: number; actorUserId: string },
): Promise<StaffDelayPlan> {
  const { data, error } = (await rpcClient(supabase)("apply_staff_appointment_delay", {
    p_appointment_id: input.appointmentId,
    p_delay_minutes: input.delayMinutes,
    p_actor_user_id: input.actorUserId,
  })) as { data: StaffDelayPlan | null; error: RpcError | null };

  if (error) throwRpcError(error);
  if (!data) {
    throw new ManageError("UNKNOWN", "Applied delay was not returned by the database.");
  }
  return data;
}
