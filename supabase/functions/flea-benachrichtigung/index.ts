// Flohmarkt-Benachrichtigungen per Brevo (neu).
// event "eingereicht": Der Einsteller (eigener Artikel) bekommt eine Bestätigung:
//   online (seriös) oder in Prüfung (mit Grund).
// event "entschieden": Nur der Vorstand (is_admin) kann das auslösen. Der Einsteller erhält
//   die Mitteilung über Freigabe oder Ablehnung.
// Die E-Mail-Adresse wird immer serverseitig aus dem Artikel gelesen, nie vom Browser übernommen.
// Status und Titel kommen aus der Datenbank, nicht aus der Anfrage.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const MAIL_FROM = Deno.env.get("MAIL_FROM")!;
const SITE_URL = Deno.env.get("SITE_URL")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

function esc(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function grund(check: string | null): string {
  const r = check ?? "";
  if (r.includes("Spaß")) return "Im Titel oder in der Beschreibung steht ein Wort, das auf einen Scherz oder Spaßartikel hindeutet. Bitte formuliere die Angaben sachlich um.";
  if (r.includes("Preis")) return "Der Preis liegt über 5.000 € und muss geprüft werden. Zum Verschenken trägst du 0 € ein.";
  return "";
}

async function sendBrevo(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "VfB Grötzingen", email: MAIL_FROM },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Brevo-Fehler", res.status, detail.slice(0, 500));
  }
  return res.ok;
}

function rahmen(inhalt: string): string {
  return `${inhalt}
    <p>Sportliche Grüße<br>VfB 04 Grötzingen e.V. – Hier ist Sport daheim.</p>
    <p style="color:#666;font-size:12px">Diese E-Mail wurde automatisch versendet, weil du einen Artikel im Flohmarkt eingestellt hast.</p>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt." }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u.user) return json({ error: "Bitte zuerst anmelden." }, 401);

  let body: { item_id?: string; event?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }
  const itemId = String(body.item_id ?? "");
  const event = String(body.event ?? "");
  if (!itemId || (event !== "eingereicht" && event !== "entschieden")) {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  const { data: item } = await admin
    .from("items").select("id,title,seller_id,status,check_result").eq("id", itemId).maybeSingle();
  if (!item) return json({ error: "Artikel nicht gefunden." }, 404);

  // Berechtigung prüfen
  const { data: profile } = await admin.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
  const istAdmin = !!profile?.is_admin;
  if (event === "eingereicht" && item.seller_id !== u.user.id) return json({ error: "Nicht erlaubt." }, 403);
  if (event === "entschieden" && !istAdmin) return json({ error: "Nur der Vorstand darf Freigaben mitteilen." }, 403);
  if (event === "entschieden" && item.status === "pruefung") return json({ error: "Der Artikel ist noch nicht entschieden." }, 400);

  const { data: seller } = await admin.auth.admin.getUserById(item.seller_id);
  const sellerMail = seller.user?.email;
  if (!sellerMail) return json({ error: "Keine E-Mail-Adresse beim Einsteller." }, 500);

  const titel = esc(item.title);
  let subject: string;
  let html: string;

  if (item.status === "freigegeben") {
    subject = `Dein Artikel ist online: „${item.title}“`;
    html = rahmen(`<p>Hallo,</p>
      <p>dein Artikel <b>„${titel}“</b> wurde freigegeben und ist jetzt im Flohmarkt sichtbar.</p>
      <p>Er bleibt einen Monat online. Danach erhältst du eine E-Mail, ob du ihn verlängern möchtest.</p>
      <p><a href="${esc(SITE_URL)}">Zum Flohmarkt</a></p>`);
  } else if (item.status === "abgelehnt") {
    subject = `Dein Artikel wurde nicht freigegeben: „${item.title}“`;
    html = rahmen(`<p>Hallo,</p>
      <p>dein Artikel <b>„${titel}“</b> wurde vom Vorstand nicht freigegeben und ist daher nicht im Flohmarkt sichtbar.</p>
      <p>Wenn du Fragen hast, antworte einfach auf diese E-Mail.</p>`);
  } else {
    subject = `Dein Artikel wird geprüft: „${item.title}“`;
    const g = grund(item.check_result);
    html = rahmen(`<p>Hallo,</p>
      <p>dein Artikel <b>„${titel}“</b> wurde gespeichert und wird vom Vorstand geprüft, bevor er erscheint.</p>
      ${g ? `<p><b>Grund:</b> ${esc(g)}</p>` : ""}
      <p>Du musst nichts weiter tun. Du erhältst eine E-Mail, sobald der Artikel freigegeben oder abgelehnt wurde.</p>`);
  }

  const sent = await sendBrevo(sellerMail, subject, html);
  if (!sent) return json({ error: "E-Mail konnte nicht versendet werden." }, 502);
  return json({ ok: true, status: item.status });
});
