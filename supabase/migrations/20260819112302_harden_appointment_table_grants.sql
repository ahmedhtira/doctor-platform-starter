revoke all privileges on table public.appointments from anon;
revoke insert, update, delete, truncate, references, trigger on table public.appointments from authenticated;
grant select on table public.appointments to authenticated;
