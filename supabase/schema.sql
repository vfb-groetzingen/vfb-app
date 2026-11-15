-- VfB Grötzingen – Vereins-App: Datenbankschema
-- In Supabase: SQL Editor > New query > einfügen > Run

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', 'Mitglied'));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create table if not exists public.matches (
  id bigserial primary key,
  league text not null,
  matchday int not null,
  kickoff timestamptz,
  home text not null,
  away text not null,
  home_goals int,
  away_goals int
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  price_eur numeric(8,2) not null check (price_eur >= 0 and price_eur <= 100000),
  category text not null,
  description text check (char_length(description) <= 500),
  image_path text,
  status text not null default 'pruefung' check (status in ('pruefung','freigegeben','abgelehnt')),
  check_result text,
  expires_at timestamptz,
  reminder_sent_at timestamptz,
  renew_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create or replace function public.classify_item(t text, d text, p numeric)
returns text language plpgsql immutable as $$
declare
  txt text := lower(coalesce(t,'') || ' ' || coalesce(d,''));
begin
  if txt ~ '(spa(ß|ss)|scherz|fake|witz|haha|lol|nicht ernst|meme|test)' then
    return 'verdächtig: möglicher Spaßartikel';
  end if;
  if p < 1 or p > 5000 then
    return 'verdächtig: ungewöhnlicher Preis';
  end if;
  return 'seriös';
end $$;

create or replace function public.items_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.check_result := public.classify_item(new.title, new.description, new.price_eur);
    if new.check_result = 'seriös' then
      new.status := 'freigegeben';
    else
      new.status := 'pruefung';
    end if;
  end if;
  if new.status = 'freigegeben' and (tg_op = 'INSERT' or old.status is distinct from 'freigegeben') then
    new.expires_at := now() + interval '1 month';
    new.reminder_sent_at := null;
  end if;
  return new;
end $$;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write
  before insert or update on public.items
  for each row execute function public.items_before_write();

create or replace function public.renew_item(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.items
     set expires_at = now() + interval '1 month',
         reminder_sent_at = null,
         renew_token = gen_random_uuid()
   where renew_token = p_token and status = 'freigegeben';
  get diagnostics n = row_count;
  if n = 1 then return 'verlängert'; end if;
  return 'ungültig';
end $$;

grant execute on function public.renew_item(uuid) to anon, authenticated;

create table if not exists public.messages (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public)
values ('flea-images', 'flea-images', false)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.items enable row level security;
alter table public.messages enable row level security;

create policy "profiles lesen" on public.profiles
  for select to authenticated using (true);

create policy "spielplan lesen" on public.matches
  for select to authenticated using (true);
create policy "spielplan pflegen" on public.matches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "artikel lesen" on public.items
  for select to authenticated using (status = 'freigegeben' or seller_id = auth.uid() or public.is_admin());
create policy "artikel anlegen" on public.items
  for insert to authenticated with check (seller_id = auth.uid());
create policy "artikel loeschen" on public.items
  for delete to authenticated using (seller_id = auth.uid() or public.is_admin());
create policy "artikel pruefen" on public.items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "chat lesen" on public.messages
  for select to authenticated using (true);
create policy "chat schreiben" on public.messages
  for insert to authenticated with check (user_id = auth.uid());
create policy "chat loeschen" on public.messages
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "fotos lesen" on storage.objects
  for select to authenticated using (bucket_id = 'flea-images');
create policy "fotos hochladen" on storage.objects
  for insert to authenticated with check (bucket_id = 'flea-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos loeschen" on storage.objects
  for delete to authenticated using (bucket_id = 'flea-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Ersten Administrator festlegen (nach Registrierung und Bestätigung, E-Mail anpassen):
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'vorstand@example.de');
