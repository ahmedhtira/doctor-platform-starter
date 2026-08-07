-- M2.5: structured city for the public doctor-search homepage's city
-- filter. Nullable — additive to the already-tested M1 clinics table
-- (existing test fixtures that insert clinics without a city keep working
-- unchanged), not a breaking schema change. No RLS/grant changes needed:
-- a new column on an existing table inherits that table's row-level
-- policies and grants automatically.
alter table public.clinics add column city text;
