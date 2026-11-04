-- Public service information is separate from private payment destinations.
-- Existing doctors keep their existing booking behaviour (both flags default off).
alter table public.doctors
  add column sos_enabled boolean not null default false,
  add column sos_phone text,
  add column sos_area text,
  add column payment_required boolean not null default false,
  add column payment_mode text not null default 'deposit',
  add column payment_amount_millimes integer,
  add column payment_terms text,
  add constraint doctors_sos_phone_valid check (
    sos_phone is null or sos_phone ~ '^\+?[0-9 ()-]{6,30}$'
  ),
  add constraint doctors_sos_requires_phone check (
    not sos_enabled or (sos_phone is not null and length(regexp_replace(sos_phone, '[^0-9]', '', 'g')) >= 6)
  ),
  add constraint doctors_sos_area_length check (length(sos_area) <= 160),
  add constraint doctors_payment_mode_valid check (payment_mode in ('deposit', 'full')),
  add constraint doctors_payment_amount_valid check (
    payment_amount_millimes is null or payment_amount_millimes between 1 and 10000000
  ),
  add constraint doctors_payment_terms_length check (length(payment_terms) <= 2000),
  add constraint doctors_payment_requires_details check (
    not payment_required or (
      payment_amount_millimes is not null
      and payment_terms is not null and length(btrim(payment_terms)) > 0
    )
  );

create index doctors_sos_directory_idx on public.doctors (full_name)
  where sos_enabled and is_published and suspended_at is null and deleted_at is null;

-- Identifiers only, never passwords, card data or API keys. No public or staff
-- read/write privileges: the existing platform-admin gate owns configuration.
create table public.doctor_payment_accounts (
  doctor_id uuid primary key references public.doctors(id) on delete cascade,
  recipient_name text not null default '' check (length(recipient_name) <= 160),
  provider_name text not null default '' check (length(provider_name) <= 80),
  account_reference text not null default '' check (length(account_reference) <= 200)
);
alter table public.doctor_payment_accounts enable row level security;
revoke all on public.doctor_payment_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.doctor_payment_accounts to service_role;

-- One transaction for profile, SOS, public price/terms and private destination.
-- Only trusted server code can call it after authenticating the platform admin.
-- p_profile=NULL is used during provisioning; p_services=NULL preserves settings
-- for existing internal callers. Every writable field is explicitly allowlisted.
create function public.update_doctor_with_services(
  p_doctor_id uuid,
  p_profile jsonb default null,
  p_services jsonb default null
)
returns public.doctors
language plpgsql security definer set search_path = ''
as $$
declare
  v_doctor public.doctors;
begin
  select * into v_doctor from public.doctors where id = p_doctor_id for update;
  if v_doctor.id is null or v_doctor.deleted_at is not null then
    raise exception 'doctor not found' using errcode = 'P0002';
  end if;

  if p_profile is not null then
    update public.doctors set
      full_name = p_profile->>'full_name',
      specialty_id = (p_profile->>'specialty_id')::uuid,
      slug = p_profile->>'slug',
      default_locale = p_profile->>'default_locale',
      timezone = p_profile->>'timezone',
      min_booking_notice_minutes = (p_profile->>'min_booking_notice_minutes')::integer,
      bio = p_profile->>'bio',
      phone = p_profile->>'phone',
      page_variant = p_profile->>'page_variant',
      custom_template_key = p_profile->>'custom_template_key'
    where id = p_doctor_id;
  end if;

  if p_services is not null then
    update public.doctors set
      sos_enabled = (p_services->>'sosEnabled')::boolean,
      sos_phone = nullif(btrim(p_services->>'sosPhone'), ''),
      sos_area = nullif(btrim(p_services->>'sosArea'), ''),
      payment_required = (p_services->>'paymentRequired')::boolean,
      payment_mode = p_services->>'paymentMode',
      payment_amount_millimes = (p_services->>'paymentAmountMillimes')::integer,
      payment_terms = nullif(btrim(p_services->>'paymentTerms'), '')
    where id = p_doctor_id;

    insert into public.doctor_payment_accounts (
      doctor_id, recipient_name, provider_name, account_reference
    ) values (
      p_doctor_id,
      coalesce(p_services->>'recipientName', ''),
      coalesce(p_services->>'providerName', ''),
      coalesce(p_services->>'accountReference', '')
    ) on conflict (doctor_id) do update set
      recipient_name = excluded.recipient_name,
      provider_name = excluded.provider_name,
      account_reference = excluded.account_reference;
  end if;

  select * into v_doctor from public.doctors where id = p_doctor_id;
  return v_doctor;
end;
$$;
revoke all on function public.update_doctor_with_services(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_doctor_with_services(uuid, jsonb, jsonb) to service_role;

-- Checkout is not connected yet. Fail closed at the database boundary so an
-- old browser tab, the legacy booking RPC, or a forged request cannot create
-- an unpaid online appointment. Staff manual bookings remain available.
-- Locking the doctor serializes this decision with an admin configuration edit.
create function private.guard_online_booking_payment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_required boolean;
begin
  if new.source = 'online' then
    select payment_required into v_required
      from public.doctors where id = new.doctor_id for share;
    if v_required then
      raise exception 'payment is required; online checkout is not connected'
        using errcode = 'P0402';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_online_booking_payment() from public, anon, authenticated, service_role;
create trigger guard_online_booking_payment
  before insert on public.appointments
  for each row execute function private.guard_online_booking_payment();
