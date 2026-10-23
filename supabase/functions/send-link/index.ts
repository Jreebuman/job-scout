// Job Scout "Forgot my link?": emails people their private link when the email they type is the one in their profile's contact.
// POST {email}. The answer is always the same, so nobody can use it to find out who has signed up.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const SITE = "https://jreebuman.github.io/job-scout/";
const FROM = "Job Scout <jobscout@jreebs.com>";
const PER_EMAIL_HOUR = 3, PER_DAY = 60;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let email = "";
  try { email = String((await req.json()).email || "").trim().toLowerCase(); } catch { return json({ error: "bad request" }, 400); }
  if (email.length > 200 || !/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(email)) return json({ error: "bad_email" }, 400);

  const ok = json({ ok: true });
  // limits keep the free email allowance safe and stop anyone flooding an inbox
  const hourAgo = new Date(Date.now() - 3600e3).toISOString(), dayAgo = new Date(Date.now() - 864e5).toISOString();
  const [mine, all] = await Promise.all([
    db.from("link_requests").select("id", { count: "exact", head: true }).eq("email", email).gte("at", hourAgo),
    db.from("link_requests").select("id", { count: "exact", head: true }).gte("at", dayAgo),
  ]);
  if ((mine.count ?? 0) >= PER_EMAIL_HOUR || (all.count ?? 0) >= PER_DAY) return ok;
  await db.from("link_requests").insert({ email });

  const { data } = await db.from("profiles").select("name, access_key, contact").ilike("contact", `%${email.replace(/[%_\\]/g, "\\$&")}%`);
  const hits = (data || []).filter((p) => ((p.contact || "").toLowerCase().match(/[^\s,;<>()]+@[^\s,;<>()]+/g) || []).includes(email));
  if (!hits.length || !RESEND_KEY) return ok;

  const links = hits.map((p) => `<p style="margin:0 0 10px"><b>${esc(p.name)}</b><br><a href="${SITE}#k=${p.access_key}" style="color:#0E5A73">Open my jobs</a></p>`).join("");
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#122028">
    <p style="font-size:20px;font-weight:700;margin:0 0 14px">Job Scout</p>
    <p style="margin:0 0 14px">Here is your private link. Keep it to yourself: anyone with it can see your matches.</p>${links}
    <div dir="rtl" style="text-align:right;font-family:Tahoma,Arial,sans-serif;margin-top:18px"><p style="margin:0">هذا رابطك الخاص. لا تشاركه مع حدا، لأنه بيفتح وظائفك.</p></div>
    <p style="font-size:12px;color:#5B6E76;margin:22px 0 0">You got this because someone asked for the Job Scout link for this email. If it wasn't you, ignore it.</p></div>`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], subject: "Your Job Scout link · رابطك في Job Scout", html }),
    });
  } catch (e) { console.error("send failed", e); }
  return ok;
});
