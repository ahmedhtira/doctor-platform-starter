-- M10.2: patient-friendly specialty search. Aliases map everyday
-- wording ("cœur", "dentiste", "généraliste") onto the existing
-- canonical public.specialties rows -- never a separate/duplicate
-- specialty, per the explicit requirement that there is one canonical
-- specialty internally and the admin dropdown stays clean. Matching
-- itself (accent/case-insensitive, small-typo-tolerant) happens in
-- application code against this table's contents, not in SQL.

create table public.specialty_aliases (
  id uuid primary key default gen_random_uuid(),
  specialty_id uuid not null references public.specialties(id) on delete cascade,
  alias text not null,
  locale text not null check (locale in ('fr', 'ar')),
  created_at timestamptz not null default now(),
  -- One alias resolves to exactly one specialty (per locale) -- keeps
  -- resolution deterministic, no ambiguous alias pointing two ways.
  unique (alias, locale)
);

alter table public.specialty_aliases enable row level security;

create policy "specialty_aliases_public_read" on public.specialty_aliases
  for select
  using (true);

grant select on public.specialty_aliases to anon, authenticated;

-- New canonical specialty: dentistry wasn't in the original curated
-- list (a separate professional register from "médecine" in Tunisia),
-- but the requested alias set ("dentiste", "chirurgien-dentiste", ...)
-- needs something real to resolve to -- added here as its own row,
-- upserted the same idempotent way migration 23 seeds the rest.
insert into public.specialties (slug, name_fr, name_ar) values
  ('medecine-dentaire', 'Médecine dentaire', 'طب الأسنان')
on conflict (slug) do update
  set name_fr = excluded.name_fr,
      name_ar = excluded.name_ar;

-- Seed aliases, resolving each specialty by its stable slug so this
-- doesn't depend on insertion order or id values.
with alias_data (specialty_slug, alias, locale) as (
  values
    -- Médecine générale ("médecin généraliste" is patient wording for
    -- the same discipline, not a separate specialty)
    ('medecine-generale', 'médecin généraliste', 'fr'),
    ('medecine-generale', 'généraliste', 'fr'),
    ('medecine-generale', 'médecin général', 'fr'),
    ('medecine-generale', 'médecin de famille', 'fr'),
    ('medecine-generale', 'docteur généraliste', 'fr'),
    ('medecine-generale', 'طبيب عام', 'ar'),
    ('medecine-generale', 'طبيب عائلة', 'ar'),

    ('medecine-dentaire', 'dentiste', 'fr'),
    ('medecine-dentaire', 'médecin dentaire', 'fr'),
    ('medecine-dentaire', 'chirurgien-dentiste', 'fr'),
    ('medecine-dentaire', 'soins dentaires', 'fr'),
    ('medecine-dentaire', 'طبيب أسنان', 'ar'),
    ('medecine-dentaire', 'جراح أسنان', 'ar'),

    ('cardiologie', 'cardiologue', 'fr'),
    ('cardiologie', 'cœur', 'fr'),
    ('cardiologie', 'coeur', 'fr'),
    ('cardiologie', 'problème cardiaque', 'fr'),
    ('cardiologie', 'قلب', 'ar'),
    ('cardiologie', 'طبيب قلب', 'ar'),

    ('dermatologie', 'dermatologue', 'fr'),
    ('dermatologie', 'peau', 'fr'),
    ('dermatologie', 'acné', 'fr'),
    ('dermatologie', 'cheveux', 'fr'),
    ('dermatologie', 'ongles', 'fr'),
    ('dermatologie', 'جلد', 'ar'),
    ('dermatologie', 'طبيب جلدية', 'ar'),
    ('dermatologie', 'حب الشباب', 'ar'),

    ('gynecologie-obstetrique', 'gynécologue', 'fr'),
    ('gynecologie-obstetrique', 'grossesse', 'fr'),
    ('gynecologie-obstetrique', 'femme', 'fr'),
    ('gynecologie-obstetrique', 'suivi grossesse', 'fr'),
    ('gynecologie-obstetrique', 'نساء', 'ar'),
    ('gynecologie-obstetrique', 'حمل', 'ar'),
    ('gynecologie-obstetrique', 'ولادة', 'ar'),

    ('pediatrie', 'pédiatre', 'fr'),
    ('pediatrie', 'enfant', 'fr'),
    ('pediatrie', 'bébé', 'fr'),
    ('pediatrie', 'طفل', 'ar'),
    ('pediatrie', 'أطفال', 'ar'),
    ('pediatrie', 'رضيع', 'ar'),

    ('ophtalmologie', 'ophtalmologue', 'fr'),
    ('ophtalmologie', 'yeux', 'fr'),
    ('ophtalmologie', 'vision', 'fr'),
    ('ophtalmologie', 'عيون', 'ar'),
    ('ophtalmologie', 'نظر', 'ar'),

    ('orl', 'orl', 'fr'),
    ('orl', 'oto-rhino-laryngologue', 'fr'),
    ('orl', 'oreilles', 'fr'),
    ('orl', 'nez', 'fr'),
    ('orl', 'gorge', 'fr'),
    ('orl', 'أذن أنف حنجرة', 'ar'),
    ('orl', 'أذن', 'ar'),
    ('orl', 'حلق', 'ar'),

    ('psychiatrie', 'psychiatre', 'fr'),
    ('psychiatrie', 'santé mentale', 'fr'),
    ('psychiatrie', 'طب نفسي', 'ar'),
    ('psychiatrie', 'صحة نفسية', 'ar'),

    ('neurologie', 'neurologue', 'fr'),
    ('neurologie', 'nerfs', 'fr'),
    ('neurologie', 'cerveau', 'fr'),
    ('neurologie', 'أعصاب', 'ar'),
    ('neurologie', 'دماغ', 'ar'),

    ('gastro-enterologie', 'gastro', 'fr'),
    ('gastro-enterologie', 'gastro-entérologue', 'fr'),
    ('gastro-enterologie', 'estomac', 'fr'),
    ('gastro-enterologie', 'digestion', 'fr'),
    ('gastro-enterologie', 'معدة', 'ar'),
    ('gastro-enterologie', 'هضم', 'ar'),

    ('endocrinologie', 'endocrinologue', 'fr'),
    ('endocrinologie', 'diabète', 'fr'),
    ('endocrinologie', 'thyroïde', 'fr'),
    ('endocrinologie', 'hormones', 'fr'),
    ('endocrinologie', 'سكري', 'ar'),
    ('endocrinologie', 'غدة درقية', 'ar'),

    ('pneumologie', 'pneumologue', 'fr'),
    ('pneumologie', 'poumons', 'fr'),
    ('pneumologie', 'respiration', 'fr'),
    ('pneumologie', 'رئة', 'ar'),
    ('pneumologie', 'تنفس', 'ar'),

    ('rhumatologie', 'rhumatologue', 'fr'),
    ('rhumatologie', 'articulations', 'fr'),
    ('rhumatologie', 'douleurs articulaires', 'fr'),
    ('rhumatologie', 'مفاصل', 'ar'),

    ('orthopedie-traumatologie', 'orthopédiste', 'fr'),
    ('orthopedie-traumatologie', 'os', 'fr'),
    ('orthopedie-traumatologie', 'fracture', 'fr'),
    ('orthopedie-traumatologie', 'articulation', 'fr'),
    ('orthopedie-traumatologie', 'عظام', 'ar'),
    ('orthopedie-traumatologie', 'كسر', 'ar'),

    ('urologie', 'urologue', 'fr'),
    ('urologie', 'prostate', 'fr'),
    ('urologie', 'appareil urinaire', 'fr'),
    ('urologie', 'بروستاتا', 'ar'),

    ('nephrologie', 'néphrologue', 'fr'),
    ('nephrologie', 'reins', 'fr'),
    ('nephrologie', 'كلى', 'ar'),

    ('medecine-urgence', 'urgence', 'fr'),
    ('medecine-urgence', 'urgentiste', 'fr'),
    ('medecine-urgence', 'طوارئ', 'ar'),

    ('nutrition', 'nutritionniste', 'fr'),
    ('nutrition', 'alimentation', 'fr'),
    ('nutrition', 'régime', 'fr'),
    ('nutrition', 'تغذية', 'ar'),
    ('nutrition', 'نظام غذائي', 'ar')
)
insert into public.specialty_aliases (specialty_id, alias, locale)
select s.id, ad.alias, ad.locale
from alias_data ad
join public.specialties s on s.slug = ad.specialty_slug
on conflict (alias, locale) do nothing;
