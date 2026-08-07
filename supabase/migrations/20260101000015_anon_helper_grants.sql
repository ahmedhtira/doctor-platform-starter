-- The public-visibility SELECT policies (doctors, clinics,
-- appointment_types, doctor_profile_content tables) reference
-- private.is_staff_for_doctor as one arm of an `is_published OR
-- is_staff_for_doctor(...)` condition. Postgres requires EXECUTE privilege
-- on every function a query references in order to plan the query at all —
-- it doesn't matter that the is_published branch would short-circuit for
-- anon in practice. Without this grant, anon gets "permission denied for
-- function is_staff_for_doctor" even on rows it's otherwise allowed to see.
grant execute on function private.is_staff_for_doctor(uuid, uuid) to anon;
