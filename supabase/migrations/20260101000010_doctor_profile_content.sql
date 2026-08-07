-- M1: public-profile enrichment content. Same visibility rule as the
-- doctor row itself: public when the doctor is published, otherwise staff
-- only. Writes are staff-only.
create table public.doctor_qualifications (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  title text not null,
  institution text,
  year_obtained integer,
  created_at timestamptz not null default now()
);

create table public.doctor_publications (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  title text not null,
  publication_name text,
  url text,
  published_year integer,
  created_at timestamptz not null default now()
);

create table public.doctor_books (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  title text not null,
  publisher text,
  published_year integer,
  url text,
  created_at timestamptz not null default now()
);

create table public.doctor_media_appearances (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  title text not null,
  outlet text,
  url text,
  appeared_on date,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['doctor_qualifications', 'doctor_publications', 'doctor_books', 'doctor_media_appearances']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy "%s_select" on public.%I for select using (
         exists (select 1 from public.doctors d where d.id = doctor_id and d.is_published)
         or private.is_staff_for_doctor(auth.uid(), doctor_id)
       )', t, t
    );

    execute format(
      'create policy "%s_insert" on public.%I for insert with check (private.is_staff_for_doctor(auth.uid(), doctor_id))',
      t, t
    );

    execute format(
      'create policy "%s_update" on public.%I for update using (private.is_staff_for_doctor(auth.uid(), doctor_id)) with check (private.is_staff_for_doctor(auth.uid(), doctor_id))',
      t, t
    );

    execute format(
      'create policy "%s_delete" on public.%I for delete using (private.is_staff_for_doctor(auth.uid(), doctor_id))',
      t, t
    );

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select on public.%I to anon', t);
  end loop;
end;
$$;
