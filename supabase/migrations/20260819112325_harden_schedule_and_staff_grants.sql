revoke all privileges on table public.working_hours from anon;
revoke all privileges on table public.breaks from anon;
revoke all privileges on table public.blocked_periods from anon;
revoke all privileges on table public.schedule_exceptions from anon;
revoke all privileges on table public.doctor_secretaries from anon;

revoke truncate, references, trigger on table public.working_hours from authenticated;
revoke truncate, references, trigger on table public.breaks from authenticated;
revoke truncate, references, trigger on table public.blocked_periods from authenticated;
revoke truncate, references, trigger on table public.schedule_exceptions from authenticated;
revoke truncate, references, trigger on table public.doctor_secretaries from authenticated;

grant select, insert, update, delete on table public.working_hours to authenticated;
grant select, insert, update, delete on table public.breaks to authenticated;
grant select, insert, update, delete on table public.blocked_periods to authenticated;
grant select, insert, update, delete on table public.schedule_exceptions to authenticated;
grant select, insert, update, delete on table public.doctor_secretaries to authenticated;
