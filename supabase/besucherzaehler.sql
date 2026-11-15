-- VfB Grötzingen – Besucherzähler (Startwert 100)
-- In Supabase: SQL Editor > New query > einfügen > Run
-- Die Tabelle ist für Besucher nicht direkt lesbar. Zugriff nur über die beiden Funktionen unten.

create table if not exists public.besucher (
  id int primary key default 1 check (id = 1),
  anzahl bigint not null default 100
);
insert into public.besucher (id, anzahl) values (1, 100) on conflict (id) do nothing;
alter table public.besucher enable row level security;

-- Zählt einen neuen Besuch und liefert den neuen Stand
create or replace function public.besucher_zaehlen()
returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  update public.besucher set anzahl = anzahl + 1 where id = 1 returning anzahl into n;
  return n;
end $$;

-- Liefert nur den aktuellen Stand, zählt nicht
create or replace function public.besucher_stand()
returns bigint language sql stable security definer set search_path = public as $$
  select anzahl from public.besucher where id = 1
$$;

grant execute on function public.besucher_zaehlen() to anon, authenticated;
grant execute on function public.besucher_stand() to anon, authenticated;
