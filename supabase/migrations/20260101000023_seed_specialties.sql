-- M10.1: seed the (previously empty) public.specialties reference table
-- with a curated, Tunisia-appropriate list. public.specialties itself
-- was created in migration 2 with zero seed rows -- the only rows that
-- ever existed anywhere were ad hoc (scripts/seed-doctor.ts's single
-- "cardiologie" dev fixture, or whatever an admin happened to create by
-- hand). This is data only, not a schema change: no new column, table,
-- policy, or grant.
--
-- upsert on slug, updating only the display names -- never touches `id`,
-- so any doctor.specialty_id already pointing at one of these rows (e.g.
-- the local dev seed's "cardiologie") keeps working unchanged, and
-- re-running this migration (or a future edit to the wording) is safe.
insert into public.specialties (slug, name_fr, name_ar) values
  ('medecine-generale', 'Médecine générale', 'الطب العام'),
  ('cardiologie', 'Cardiologie', 'أمراض القلب'),
  ('dermatologie', 'Dermatologie', 'الأمراض الجلدية'),
  ('endocrinologie', 'Endocrinologie', 'أمراض الغدد الصماء والسكري'),
  ('gastro-enterologie', 'Gastro-entérologie', 'أمراض الجهاز الهضمي'),
  ('gynecologie-obstetrique', 'Gynécologie-obstétrique', 'أمراض النساء والتوليد'),
  ('neurologie', 'Neurologie', 'أمراض الأعصاب'),
  ('pediatrie', 'Pédiatrie', 'طب الأطفال'),
  ('psychiatrie', 'Psychiatrie', 'الطب النفسي'),
  ('rhumatologie', 'Rhumatologie', 'أمراض الروماتيزم'),
  ('nephrologie', 'Néphrologie', 'أمراض الكلى'),
  ('pneumologie', 'Pneumologie (Pneumo-allergologie)', 'أمراض الرئة والحساسية'),
  ('medecine-interne', 'Médecine interne', 'الطب الباطني'),
  ('maladies-infectieuses', 'Maladies infectieuses', 'الأمراض الإنتانية'),
  ('hematologie', 'Hématologie', 'أمراض الدم'),
  ('oncologie', 'Oncologie (Carcinologie médicale)', 'علم الأورام'),
  ('ophtalmologie', 'Ophtalmologie', 'طب العيون'),
  ('orl', 'ORL (Oto-rhino-laryngologie)', 'أنف أذن حنجرة'),
  ('urologie', 'Urologie', 'أمراض المسالك البولية'),
  ('orthopedie-traumatologie', 'Orthopédie et traumatologie', 'جراحة العظام والرضوح'),
  ('neurochirurgie', 'Neurochirurgie', 'جراحة الأعصاب'),
  ('chirurgie-generale', 'Chirurgie générale', 'الجراحة العامة'),
  ('chirurgie-cardiovasculaire', 'Chirurgie cardiovasculaire', 'جراحة القلب والأوعية الدموية'),
  ('chirurgie-thoracique', 'Chirurgie thoracique', 'جراحة الصدر'),
  ('chirurgie-vasculaire', 'Chirurgie vasculaire', 'جراحة الأوعية الدموية'),
  ('chirurgie-pediatrique', 'Chirurgie pédiatrique', 'جراحة الأطفال'),
  ('chirurgie-plastique', 'Chirurgie plastique', 'الجراحة التجميلية'),
  ('chirurgie-maxillo-faciale', 'Chirurgie maxillo-faciale', 'جراحة الفك والوجه'),
  ('anesthesie-reanimation', 'Anesthésie-réanimation', 'التخدير والإنعاش'),
  ('medecine-urgence', 'Médecine d''urgence', 'طب الطوارئ'),
  ('medecine-physique-readaptation', 'Médecine physique et réadaptation', 'الطب الفيزيائي وإعادة التأهيل'),
  ('medecine-travail', 'Médecine du travail', 'طب الشغل'),
  ('medecine-legale', 'Médecine légale', 'الطب الشرعي'),
  ('medecine-nucleaire', 'Médecine nucléaire', 'الطب النووي'),
  ('radiologie', 'Radiologie (Imagerie médicale)', 'الأشعة والتصوير الطبي'),
  ('radiotherapie', 'Radiothérapie', 'العلاج الإشعاعي'),
  ('nutrition', 'Nutrition', 'التغذية'),
  ('pedopsychiatrie', 'Pédopsychiatrie', 'الطب النفسي للأطفال'),
  ('neonatologie', 'Néonatologie', 'طب حديثي الولادة')
on conflict (slug) do update
  set name_fr = excluded.name_fr,
      name_ar = excluded.name_ar;
