// Flohmarkt-Anfrage: Ein angemeldetes Mitglied schreibt dem Verkäufer.
// Die E-Mail-Adresse des Verkäufers verlässt den Server nie; die Antwort geht per Reply-To an den Anfragenden.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const MAIL_FROM = Deno.env.get("MAIL_FROM")!;

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
    .from("items").select("id,title,seller_id,status").eq("id", itemId).maybeSingle();
  if (!item || item.status !== "freigegeben") return json({ error: "Dieser Artikel ist nicht verfügbar." }, 404);
  if (item.seller_id === u.user.id) return json({ error: "Das ist dein eigener Artikel." }, 400);

  const { data: seller } = await admin.auth.admin.getUserById(item.seller_id);
  const sellerMail = seller.user?.email;
  if (!sellerMail) return json({ error: "Der Verkäufer ist derzeit nicht erreichbar." }, 500);

  const { data: asker } = await admin
    .from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
  const askerName = asker?.display_name || "Mitglied";

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "VfB Grötzingen", email: MAIL_FROM },
      to: [{ email: sellerMail }],
      replyTo: { email: u.user.email, name: askerName },
      subject: `Anfrage zu deinem Flohmarkt-Artikel „${item.title}“`,
      htmlContent: `<p>Hallo,</p>
        <p><b>${esc(askerName)}</b> interessiert sich für deinen Artikel <b>„${esc(item.title)}“</b> und schreibt:</p>
        <blockquote>${esc(message).replace(/\n/g, "<br>")}</blockquote>
        <p>Du kannst direkt auf diese E-Mail antworten. Dabei wird die Adresse des Interessenten verwendet.</p>
        <p>Sportliche Grüße<br>VfB Grötzingen – Hier ist Sport daheim.</p>`,
    }),
  });
  if (!res.ok) {
  const detail = await res.text();
  console.error("Brevo-Fehler", res.status, detail);
  return json({ error: "Die Nachricht konnte nicht versendet werden." }, 502);
}

  return json({ ok: true });
});
