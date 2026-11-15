// Flohmarkt-Pflege (v2): Erinnerung nach 1 Monat, Löschung nach 1 Woche ohne Reaktion.
// Wird täglich von GitHub Actions aufgerufen. Bei Fehlern erhält der Admin eine E-Mail (Secret ADMIN_MAIL).

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const SITE_URL = Deno.env.get("SITE_URL")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY")!;
const MAIL_FROM = Deno.env.get("MAIL_FROM")!;
const ADMIN_MAIL = Deno.env.get("ADMIN_MAIL") ?? "";
const DAY = 24 * 60 * 60 * 1000;

function esc(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
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
  if (!res.ok) throw new Error(`Mailversand fehlgeschlagen (${res.status}): ${await res.text()}`);
}

// Fehlerbenachrichtigung an den Admin. Schlägt selbst fehl, wird nur protokolliert.
async function alertAdmin(betreff: string, details: string[]): Promise<void> {
  console.error("Flohmarkt-Pflege Fehler:", betreff, details);
  if (!ADMIN_MAIL) return;
  try {
    await sendMail(
      ADMIN_MAIL,
      `[VfB-App] Fehler Flohmarkt-Pflege: ${betreff}`,
      `<p>Bei der täglichen Flohmarkt-Pflege ist ein Fehler aufgetreten.</p>
       <p><b>${esc(betreff)}</b></p>
       <pre style="white-space:pre-wrap">${esc(details.join("\n").slice(0, 3000))}</pre>
       <p>Zeitpunkt: ${new Date().toISOString()}</p>`,
    );
  } catch (err) {
    console.error("Admin-Benachrichtigung fehlgeschlagen:", String(err));
  }
}

async function emailOf(userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) return null;
  return data.user?.email ?? null;
}

const footer = `<p>Sportliche Grüße<br>VfB Grötzingen – Hier ist Sport daheim.<br>www.vfb-groetzingen.de</p>`;

async function pflege(): Promise<{ erinnert: number; geloescht: number; fehler: string[] }> {
  const now = new Date();
  const report = { erinnert: 0, geloescht: 0, fehler: [] as string[] };

  // 0) Anfrage-Protokoll aufräumen (nur für die Spam-Begrenzung nötig, nach 2 Tagen löschen)
  await admin.from("anfragen_log").delete().lt("created_at", new Date(now.getTime() - 2 * DAY).toISOString());

  // 1) Laufzeit abgelaufen, noch keine Erinnerung
  const { data: due, error: e1 } = await admin
    .from("items")
    .select("id,title,seller_id,renew_token")
    .eq("status", "freigegeben")
    .lte("expires_at", now.toISOString())
    .is("reminder_sent_at", null);
  if (e1) {
    throw new Error("Abfrage Erinnerungen: " + e1.message);
  }

  for (const it of due ?? []) {
    try {
      const to = await emailOf(it.seller_id);
      if (to) {
        const link = `${SITE_URL}/?renew=${it.renew_token}`;
        await sendMail(
          to,
          `Dein Flohmarkt-Artikel „${it.title}“ – verlängern?`,
          `<p>Hallo,</p>
           <p>dein Artikel <b>„${esc(it.title)}“</b> ist seit einem Monat auf dem Flohmarkt.</p>
           <p><a href="${link}">Ja, Artikel um einen Monat verlängern</a></p>
           <p>Wenn du nicht reagierst, wird der Artikel in einer Woche automatisch gelöscht.</p>
           ${footer}`,
        );
      }
      await admin.from("items").update({ reminder_sent_at: now.toISOString() }).eq("id", it.id);
      report.erinnert++;
    } catch (err) {
      report.fehler.push(`Erinnerung ${it.id}: ${String(err)}`);
    }
  }

  // 2) Erinnerung vor mehr als 7 Tagen, nicht verlängert
  const cutoff = new Date(now.getTime() - 7 * DAY).toISOString();
  const { data: old, error: e2 } = await admin
    .from("items")
    .select("id,title,seller_id,image_path")
    .not("reminder_sent_at", "is", null)
    .lte("reminder_sent_at", cutoff);
  if (e2) {
    throw new Error("Abfrage Löschungen: " + e2.message);
  }

  for (const it of old ?? []) {
    try {
      if (it.image_path) {
        await admin.storage.from("flea-images").remove([it.image_path]);
      }
      const { error } = await admin.from("items").delete().eq("id", it.id);
      if (error) throw error;
      const to = await emailOf(it.seller_id);
      if (to) {
        await sendMail(
          to,
          `Dein Flohmarkt-Artikel „${it.title}“ wurde entfernt`,
          `<p>Hallo,</p>
           <p>dein Artikel <b>„${esc(it.title)}“</b> wurde entfernt, weil keine Verlängerung erfolgte.</p>
           <p>Du kannst jederzeit einen neuen Artikel einstellen.</p>
           ${footer}`,
        );
      }
      report.geloescht++;
    } catch (err) {
      report.fehler.push(`Löschung ${it.id}: ${String(err)}`);
    }
  }

  if (report.fehler.length > 0) {
    await alertAdmin(`${report.fehler.length} Einzelfehler`, report.fehler);
  }
  return report;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    return Response.json(await pflege());
  } catch (err) {
    // Unerwartete Fehler: Admin benachrichtigen und 500 zurückgeben (GitHub Actions wird rot)
    const text = String(err);
    await alertAdmin("Unerwarteter Abbruch", [text]);
    return new Response(text, { status: 500 });
  }
});
