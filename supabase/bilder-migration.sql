-- VfB Grötzingen – Mehrere Bilder pro Flohmarkt-Artikel (bis zu 4)
-- In Supabase: SQL Editor > New query > einfügen > Run
-- Voraussetzung: schema.sql und die bisherigen Erweiterungen wurden bereits ausgeführt.

-- 1) Neue Spalte für mehrere Bildpfade (die alte Spalte image_path bleibt erhalten)
alter table public.items
  add column if not exists image_paths text[] not null default '{}';

-- 2) Bestehende Einzelbilder übernehmen
update public.items
   set image_paths = array[image_path]
 where image_path is not null
   and image_paths = '{}';

-- 3) Obergrenze von 4 Bildern in der Datenbank erzwingen
alter table public.items drop constraint if exists items_max_4_bilder;
alter table public.items
  add constraint items_max_4_bilder check (cardinality(image_paths) <= 4);
