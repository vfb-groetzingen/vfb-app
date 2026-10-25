// Flohmarkt-Anfrage (v2): Ein angemeldetes Mitglied schreibt dem Verkäufer.
// Die E-Mail-Adresse des Verkäufers verlässt den Server nie; die Antwort geht per Reply-To an den Anfragenden.
// Begrenzung: max. 5 Anfragen pro Stunde und Mitglied. Bestätigung geht an den Anfragenden.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const MAIL_FROM = Deno.env.get("MAIL_FROM")!;
const HOUR_LIMIT = 5;

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

async function sendBrevo(payload: unknown, context: string): Promise<boolean> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("Brevo-Fehler", res.status, context, detail.slice(0, 500));
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt." }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u.user || !u.user.email) return json({ error: "Bitte zuerst anmelden." }, 401);

  let body: { item_id?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }
  const itemId = String(body.item_id ?? "");
  const message = String(body.message ?? "").trim();
  if (!itemId || message.length < 5 || message.length > 500) {
    return json({ error: "Bitte eine Nachricht mit 5 bis 500 Zeichen eingeben." }, 400);
  }

  const { data: item } = await admin
    .from("items").select("id,title,seller_id,status,sold_at").eq("id", itemId).maybeSingle();
  if (!item || item.status !== "freigegeben") return json({ error: "Dieser Artikel ist nicht verfügbar." }, 404);
  if (item.sold_at) return json({ error: "Dieser Artikel ist bereits verkauft." }, 400);
  if (item.seller_id === u.user.id) return json({ error: "Das ist dein eigener Artikel." }, 400);

  // Rate-Limit: Anfragen der letzten Stunde zählen
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: cErr } = await admin
    .from("anfragen_log").select("id", { count: "exact", head: true })
    .eq("user_id", u.user.id).gte("created_at", since);
  if (cErr) {
    console.error("Limit-Prüfung fehlgeschlagen", cErr.message);
    return json({ error: "Die Anfrage konnte gerade nicht geprüft werden. Bitte später erneut versuchen." }, 500);
  }
  if ((count ?? 0) >= HOUR_LIMIT) {
    return json({ error: `Du hast in der letzten Stunde bereits ${HOUR_LIMIT} Anfragen gesendet. Bitte warte etwas.` }, 429);
  }

  const { data: seller } = await admin.auth.admin.getUserById(item.seller_id);
  const sellerMail = seller.user?.email;
  if (!sellerMail) return json({ error: "Der Verkäufer ist derzeit nicht erreichbar." }, 500);

  const { data: asker } = await admin
    .from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
  const askerName = asker?.display_name || "Mitglied";

  const sent = await sendBrevo({
    sender: { name: "VfB Grötzingen", email: MAIL_FROM },
    to: [{ email: sellerMail }],
    replyTo: { email: u.user.email, name: askerName },
    subject: `Anfrage zu deinem Flohmarkt-Artikel „${item.title}“`,
    htmlContent: `<p>Hallo,</p>
      <p><b>${esc(askerName)}</b> interessiert sich für deinen Artikel <b>„${esc(item.title)}“</b> und schreibt:</p>
      <blockquote>${esc(message).replace(/\n/g, "<br>")}</blockquote>
      <p>Du kannst direkt auf diese E-Mail antworten. Dabei wird die Adresse des Interessenten verwendet.</p>
      <p>Sportliche Grüße<br>VfB Grötzingen – Hier ist Sport daheim.</p>`,
  }, "Anfrage an Verkäufer");
  if (!sent) return json({ error: "Die Nachricht konnte nicht versendet werden." }, 502);

  // Protokoll erst nach erfolgreichem Versand schreiben
  await admin.from("anfragen_log").insert({ user_id: u.user.id });

  // Bestätigung an den Anfragenden (Fehler hier sind nicht kritisch)
  await sendBrevo({
    sender: { name: "VfB Grötzingen", email: MAIL_FROM },
    to: [{ email: u.user.email }],
    subject: `Deine Anfrage zu „${item.title}“ wurde gesendet`,
    htmlContent: `<p>Hallo ${esc(askerName)},</p>
      <p>deine Anfrage zum Artikel <b>„${esc(item.title)}“</b> wurde an den Verkäufer weitergeleitet.</p>
      <p>Der Verkäufer antwortet dir direkt per E-Mail. Bitte habe etwas Geduld.</p>
      <p>Sportliche Grüße<br>VfB Grötzingen – Hier ist Sport daheim.</p>`,
  }, "Bestätigung an Anfragenden");

  return json({ ok: true });
});
