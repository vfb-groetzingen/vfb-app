-- VfB Grötzingen – Flohmarkt: Artikel durch Verkäufer bearbeiten
-- In Supabase: SQL Editor > New query > einfügen > Run
-- Voraussetzung: schema.sql wurde bereits ausgeführt.

-- 1) Verkäufer dürfen ihre eigenen Artikel ändern
drop policy if exists "artikel bearbeiten" on public.items;
create policy "artikel bearbeiten" on public.items
  for update to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

-- 2) Schutzlogik für Verkäufer:
--    - Eigentümer und Status/Prüfergebnis kann nur der Vorstand ändern.
--    - Ändern sich Titel, Preis, Kategorie oder Beschreibung, wird der Artikel neu geprüft.
--    Der Name beginnt mit "items_before_update", daher läuft er vor "items_before_write".
create or replace function public.items_before_update_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;

  new.seller_id := old.seller_id;

  if (new.title, new.description, new.price_eur, new.category)
     is distinct from (old.title, old.description, old.price_eur, old.category) then
    new.check_result := public.classify_item(new.title, new.description, new.price_eur);
    if new.check_result = 'seriös' then
      new.status := 'freigegeben';
    else
      new.status := 'pruefung';
    end if;
  else
    new.status := old.status;
    new.check_result := old.check_result;
  end if;

  return new;
end $$;

drop trigger if exists items_before_update_seller on public.items;
create trigger items_before_update_seller
  before update on public.items
  for each row execute function public.items_before_update_seller();
