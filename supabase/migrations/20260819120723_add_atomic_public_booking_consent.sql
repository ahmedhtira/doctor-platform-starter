create or replace function public.book_public_appointment(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_appointment_type_id uuid,
  p_starts_at timestamptz,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_management_token_hash text,
  p_management_token_expires_at timestamptz,
  p_privacy_consent boolean,
  p_adult_confirmation boolean,
  p_privacy_policy_version text
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
begin
  if p_privacy_consent is distinct from true then
    raise exception 'privacy consent is required'
      using errcode = '22023';
  end if;

  if p_adult_confirmation is distinct from true then
    raise exception 'adult confirmation is required'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_privacy_policy_version), '') is null then
    raise exception 'privacy policy version is required'
      using errcode = '22023';
  end if;

  select *
  into v_appointment
  from public.book_appointment(
    p_doctor_id,
    p_clinic_id,
    p_appointment_type_id,
    p_starts_at,
    p_patient_name,
    p_patient_phone,
    p_patient_email,
    null,
    p_management_token_hash,
    p_management_token_expires_at
  );

  insert into public.audit_log (
    actor_user_id,
    action,
    entity_table,
    entity_id,
    details
  )
  values (
    null,
    'patient_booking_consent',
    'appointments',
    v_appointment.id,
    jsonb_build_object(
      'privacy_consent', true,
      'adult_confirmation', true,
      'privacy_policy_version', p_privacy_policy_version,
      'consented_at', now()
    )
  );

  return v_appointment;
end;
$$;

revoke all on function public.book_public_appointment(
  uuid, uuid, uuid, timestamptz, text, text, text,
  text, timestamptz, boolean, boolean, text
) from public, anon, authenticated;

grant execute on function public.book_public_appointment(
  uuid, uuid, uuid, timestamptz, text, text, text,
  text, timestamptz, boolean, boolean, text
) to service_role;
