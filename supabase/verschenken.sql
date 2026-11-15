-- Zu verschenken (Preis 0 €) und genauere Prüfgründe
-- Bisher wurden Artikel unter 1 € als "ungewöhnlicher Preis" eingestuft.
-- Ab jetzt sind 0 € erlaubt (= zu verschenken). Negative Preise und Preise über 5.000 € werden geprüft.

create or replace function public.classify_item(t text, d text, p numeric)
returns text language plpgsql immutable as $$
declare
  txt text := lower(coalesce(t,'') || ' ' || coalesce(d,''));
begin
  if txt ~ '\m(spa(ß|ss)|scherz|fake|witz|haha|lol\M|nicht ernst|meme)' then
    return 'verdächtig: möglicher Spaßartikel';
  end if;
  if p < 0 or p > 5000 then
    return 'verdächtig: ungewöhnlicher Preis';
  end if;
  return 'seriös';
end $$;

-- Hinweis: Artikel, die bisher wegen 0 € in der Prüfung hängen, bitte im Vorstandsbereich
-- (Reiter "Prüfung") freigeben. Sie werden nicht automatisch geändert.
