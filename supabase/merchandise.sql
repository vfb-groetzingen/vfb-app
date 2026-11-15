-- Merchandise: Artikel immer oben anzeigen, ohne Verlängerung und ohne automatische Löschung.
-- In Supabase: SQL Editor > New query > einfügen > Run

-- 1) Neue Spalte
alter table public.items
  add column if not exists pinned boolean not null default false;

create index if not exists items_pinned_idx on public.items (pinned) where pinned;

-- 2) Nur der Administrator darf die Markierung setzen oder ändern.
--    Mitglieder können ihre eigenen Artikel bearbeiten, aber pinned bleibt unverändert.
create or replace function public.items_pinned_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.pinned := false;
    elsif new.pinned is distinct from old.pinned then
      new.pinned := old.pinned;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists items_pinned_guard on public.items;
create trigger items_pinned_guard
  before insert or update on public.items
  for each row execute function public.items_pinned_guard();
