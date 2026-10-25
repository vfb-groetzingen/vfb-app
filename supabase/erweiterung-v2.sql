-- VfB Grötzingen – Erweiterungen v2
-- In Supabase: SQL Editor > New query > einfügen > Run
-- Voraussetzung: schema.sql, update-artikel-bearbeiten.sql und flohmarkt-oeffentlich.sql wurden bereits ausgeführt.

-- 1) Verkauft-Status
alter table public.items add column if not exists sold_at timestamptz;

-- 2) Meldungen (Artikel oder Chat-Nachricht)
create table if not exists public.reports (
  id bigserial primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  message_id bigint references public.messages(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  created_at timestamptz not null default now(),
  constraint reports_ziel check ((item_id is not null) <> (message_id is not null))
);
alter table public.reports enable row level security;

drop policy if exists "meldung anlegen" on public.reports;
create policy "meldung anlegen" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists "meldung lesen admin" on public.reports;
create policy "meldung lesen admin" on public.reports
  for select to authenticated using (public.is_admin());

drop policy if exists "meldung loeschen admin" on public.reports;
create policy "meldung loeschen admin" on public.reports
  for delete to authenticated using (public.is_admin());

-- 3) Protokoll für die Begrenzung der Anfragen (nur Edge Function schreibt hier)
create table if not exists public.anfragen_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.anfragen_log enable row level security;

-- 4) Begrenzungen gegen Spam
create or replace function public.limit_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.messages
      where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Du hast in der letzten Stunde schon viele Nachrichten gesendet. Bitte warte kurz.';
  end if;
  return new;
end $$;

drop trigger if exists messages_limit on public.messages;
create trigger messages_limit before insert on public.messages
  for each row execute function public.limit_chat();

create or replace function public.limit_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.items
      where seller_id = new.seller_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Du kannst maximal 10 Artikel pro Tag einstellen.';
  end if;
  return new;
end $$;

drop trigger if exists items_limit on public.items;
create trigger items_limit before insert on public.items
  for each row execute function public.limit_items();

-- 5) Anzeigename ändern (ohne Recht, sich selbst zum Admin zu machen)
create or replace function public.update_display_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(trim(p_name)) < 2 or char_length(trim(p_name)) > 60 then
    raise exception 'Der Anzeigename muss zwischen 2 und 60 Zeichen lang sein.';
  end if;
  update public.profiles set display_name = trim(p_name) where id = auth.uid();
end $$;
grant execute on function public.update_display_name(text) to authenticated;

-- 6) Prüfung auf Spaßartikel: Wortanfang statt Textteil (z. B. "Testspiel" oder "Fußballtest" lösen nicht mehr aus)
create or replace function public.classify_item(t text, d text, p numeric)
returns text language plpgsql immutable as $$
declare
  txt text := lower(coalesce(t,'') || ' ' || coalesce(d,''));
begin
  if txt ~ '\m(spa(ß|ss)|scherz|fake|witz|haha|lol\M|nicht ernst|meme)' then
    return 'verdächtig: möglicher Spaßartikel';
  end if;
  if p < 1 or p > 5000 then
    return 'verdächtig: ungewöhnlicher Preis';
  end if;
  return 'seriös';
end $$;

-- 8) Admin darf Fotos entfernter Artikel löschen (Meldungen)
drop policy if exists "fotos loeschen admin" on storage.objects;
create policy "fotos loeschen admin" on storage.objects
  for delete to authenticated using (bucket_id = 'flea-images' and public.is_admin());
