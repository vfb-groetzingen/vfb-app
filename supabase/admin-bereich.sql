-- Administrator festlegen (einmalig, im Supabase SQL Editor ausführen)
-- Ersetze die E-Mail durch die Adresse des Vorstandsmitglieds, das die Freigaben macht.
-- Das Konto muss vorher in der App registriert sein.
-- Nach dem Ausführen: App neu laden. Der Reiter "Verwaltung" erscheint.

update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'admin@vfb-groetzingen.de');

-- Kontrolle: Sollte eine Zeile mit is_admin = true zurückgeben
select p.id, u.email, p.is_admin
from public.profiles p join auth.users u on u.id = p.id
where p.is_admin;

-- Admin wieder entfernen (falls nötig)
-- update public.profiles set is_admin = false where id = (select id from auth.users where email = 'admin@vfb-groetzingen.de');
