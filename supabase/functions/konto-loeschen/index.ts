// Konto löschen: Entfernt zuerst die Fotos des Mitglieds, danach das Konto.
// Durch Cascade werden Profil, Artikel, Chat-Nachrichten, Meldungen und Anfrage-Protokoll gelöscht.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Methode nicht erlaubt." }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u.user) return json({ error: "Bitte zuerst anmelden." }, 401);
  const userId = u.user.id;

  // Fotos liegen im Ordner mit der User-ID (siehe schema.sql)
  const paths: string[] = [];
  const { data: files, error: lErr } = await admin.storage.from("flea-images").list(userId, { limit: 1000 });
  if (lErr) {
    console.error("Fotoliste fehlgeschlagen", lErr.message);
    return json({ error: "Die Fotos konnten nicht gelöscht werden. Bitte später erneut versuchen." }, 500);
  }
  for (const f of files ?? []) {
    if (f.name) paths.push(`${userId}/${f.name}`);
  }
  if (paths.length > 0) {
    const { error: rErr } = await admin.storage.from("flea-images").remove(paths);
    if (rErr) {
      console.error("Fotos löschen fehlgeschlagen", rErr.message);
      return json({ error: "Die Fotos konnten nicht gelöscht werden. Bitte später erneut versuchen." }, 500);
    }
  }

  const { error: dErr } = await admin.auth.admin.deleteUser(userId);
  if (dErr) {
    console.error("Konto löschen fehlgeschlagen", dErr.message);
    return json({ error: "Das Konto konnte nicht gelöscht werden. Bitte wende dich an info@vfb-groetzingen.de." }, 500);
  }

  return json({ ok: true });
});
