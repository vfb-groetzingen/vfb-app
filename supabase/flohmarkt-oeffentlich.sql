-- VfB Grötzingen – Flohmarkt für Besucher sichtbar machen
-- In Supabase: SQL Editor > New query > einfügen > Run
-- Besucher (nicht angemeldet) sehen nur freigegebene Artikel und deren Fotos.
-- Anlegen, Bearbeiten und Löschen bleiben Mitgliedern vorbehalten.

-- 1) Artikel: freigegebene Artikel für alle lesbar
drop policy if exists "artikel lesen oeffentlich" on public.items;
create policy "artikel lesen oeffentlich" on public.items
  for select to anon
  using (status = 'freigegeben');

-- 2) Fotos: Bilder freigegebener Artikel für alle lesbar
drop policy if exists "fotos freigegebener artikel lesen" on storage.objects;
create policy "fotos freigegebener artikel lesen" on storage.objects
  for select to anon
  using (
    bucket_id = 'flea-images'
    and exists (
      select 1 from public.items i
      where i.image_path = storage.objects.name
        and i.status = 'freigegeben'
    )
  );
