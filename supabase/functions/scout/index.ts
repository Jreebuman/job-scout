// Job Scout search engine. Runs on Supabase, no AI and no Claude.
// POST {k}             -> search now for the profile with that private key (from the site's Run now button)
// POST {next:true} + x-cron-secret header -> nightly: search for the profile that has waited longest
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const JORDAN_GEO = "103710677";
const COOLDOWN_H = 3;
const MAX_SAVE = 25;
const MIN_SCORE = 30;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Profile = { id: string; name: string; roles: string[]; skills: string[]; cv_text: string; locations: string; min_salary: number | null; contact: string };
type Job = { id: string; title: string; company: string; location: string; url: string; source: string; posted_at: string; description: string; level: string; work_type: string };

// ---------- text helpers ----------
function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}
function strip(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d|ul|ol)>/gi, "\n").replace(/<li[^>]*>/gi, "\n• ").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
const clean = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function get(url: string, tries = 2): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,*/*" } });
      if (r.status === 200) return await r.text();
      if (r.status !== 429) return null;
    } catch { /* network hiccup: retry */ }
    await sleep(4000);
  }
  return null;
}

// ---------- vocabulary (kept in step with the site's lists) ----------
const SKILL_TERMS: Record<string, string[]> = {
  "Microsoft Excel": ["excel"], "Microsoft Word": ["ms word", "microsoft word"], "PowerPoint": ["powerpoint"], "Google Sheets": ["google sheets"],
  "Data entry": ["data entry"], "Fast typing": ["typing"], "Arabic": ["arabic"], "English": ["english"], "French": ["french"], "Turkish": ["turkish"], "German": ["german"],
  "Team leadership": ["team leader", "team lead", "lead a team", "leading a team", "supervis*", "people management"],
  "Coaching & training": ["coaching", "coach", "training", "train"], "Customer service": ["customer service", "customer support", "customer care", "customer experience"],
  "Complaint handling": ["complaint", "escalation"], "Negotiation": ["negotiat*"], "Communication": ["communication"],
  "Sales": ["sales"], "Cold calling": ["cold call*", "outbound call*", "telesales"], "Account management": ["account management", "key account*"],
  "Project management": ["project management", "pmp"], "Process improvement": ["process improvement", "continuous improvement", "streamlin*", "automation"],
  "KPI reporting": ["kpi", "kpis", "reporting", "dashboard"], "Scheduling": ["scheduling", "roster*", "shift planning", "workforce"],
  "Bookkeeping": ["bookkeeping"], "Accounting": ["accounting", "ifrs"], "Payroll": ["payroll"], "Invoicing": ["invoic*"], "Cash handling": ["cash handling", "cashier"],
  "QuickBooks": ["quickbooks"], "SAP": ["sap"], "CRM (Salesforce / HubSpot)": ["crm", "salesforce", "hubspot"], "Zendesk": ["zendesk"], "Power BI": ["power bi", "powerbi"],
  "Social media": ["social media"], "Graphic design (Photoshop / Canva)": ["photoshop", "canva", "illustrator", "graphic design"], "Basic IT support": ["troubleshoot*", "it support"],
  "Inventory management": ["inventory", "stock control"], "Logistics & delivery": ["logistics", "last-mile", "delivery operations"], "Procurement": ["procurement", "purchasing"],
  "Driving licence": ["driving licen*", "driver's licen*"], "Quality assurance": ["quality assurance", "quality monitoring", "qa"], "SLAs": ["sla", "slas", "service level"],
};
const CONCEPT: Record<string, string> = {
  customer: "customer", customers: "customer", client: "customer", clients: "customer", guest: "customer", guests: "customer", patient: "customer",
  service: "service", services: "service", care: "service", support: "service", success: "service", experience: "service", cx: "service", helpdesk: "service",
  call: "callcenter", contact: "callcenter", center: "callcenter", centre: "callcenter",
  lead: "lead", leader: "lead", supervisor: "lead", head: "lead", teamlead: "lead", team: "lead", shift: "lead",
  quality: "quality", qa: "quality", qc: "quality", assurance: "quality", control: "quality", audit: "audit", auditor: "audit", compliance: "audit",
  sales: "sales", telesales: "sales", telemarketing: "sales", seller: "sales", business: "sales", development: "sales",
  operation: "ops", operations: "ops", ops: "ops", accountant: "accounting", accounting: "accounting", bookkeeper: "accounting", finance: "finance", financial: "finance",
  hr: "hr", human: "hr", resources: "hr", recruiter: "hr", recruitment: "hr", talent: "hr",
  logistics: "logistics", supply: "logistics", warehouse: "logistics", dispatch: "logistics", dispatcher: "logistics", delivery: "logistics",
  admin: "admin", administrative: "admin", office: "admin", secretary: "admin", receptionist: "admin", reception: "admin",
};
const LEVEL_LEAD = /\b(lead|leader|supervisor|head|manager|director)\b/i;
const LEVEL_IC = /\b(representative|agent|associate|assistant|clerk|advisor|ambassador|operator|intern|trainee|junior|entry|fresh)\b/i;
// Job-title filler: says nothing about the field, so it never counts as a match on its own.
const STOP = new Set(["and", "of", "the", "for", "in", "a", "an", "to", "senior", "junior", "sr", "jr", "i", "ii", "iii", "male", "female", "with", "at", "-", "&",
  "specialist", "officer", "executive", "coordinator", "representative", "agent", "associate", "assistant", "consultant", "analyst", "trainee", "intern",
  "staff", "member", "professional", "expert", "advisor", "ambassador", "level", "entry", "fresh", "graduate", "manager", "director", "head", "chief"]);
const CITIES = ["amman", "irbid", "zarqa", "aqaba", "salt", "madaba", "karak", "mafraq", "jerash", "ajloun", "tafilah", "ma'an"];
const inJordan = (loc: string) => !/\b(ut|utah|mn|minnesota|united states|usa)\b/i.test(loc) && (/(^|,)\s*jordan\s*$/i.test(loc) || CITIES.some((c) => loc.toLowerCase().includes(c)));

function concepts(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    out.add(CONCEPT[w] || w.replace(/s$/, ""));
  }
  if (out.has("callcenter")) { out.delete("callcenter"); out.add("customer"); out.add("service"); }
  return out;
}
function roleFit(roles: string[], title: string): { fit: number; role: string } {
  let best = { fit: 0, role: roles[0] || "" };
  const t = title.toLowerCase(), tc = concepts(title);
  for (const raw of roles) {
    const role = raw.replace(/\s*\(.*\)$/, "").split(" / ")[0];
    let fit: number;
    if (t.includes(role.toLowerCase())) fit = 1;
    else {
      const rc = [...concepts(role)].filter((c) => c !== "lead" || LEVEL_LEAD.test(role));
      const core = rc.filter((c) => c !== "lead");
      if (!core.length) continue;
      const hit = core.filter((c) => tc.has(c)).length / core.length;
      fit = hit;
      if (hit > 0 && LEVEL_LEAD.test(role)) fit *= LEVEL_LEAD.test(title) ? 1 : LEVEL_IC.test(title) ? 0.65 : 0.85;
      if (hit > 0 && !LEVEL_LEAD.test(role) && /\b(manager|director|head)\b/i.test(title)) fit *= 0.75;
    }
    if (fit > best.fit) best = { fit, role };
  }
  return best;
}
function termRe(w: string): RegExp {
  const stem = w.endsWith("*"); if (stem) w = w.slice(0, -1);
  const e = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp("(^|[^a-z])" + e + (stem ? "" : "(s|es|ed|ing|er|ers)?(?![a-z])"), "i");
}
const has = (text: string, terms: string[]) => terms.some((w) => termRe(w).test(text));
const termsFor = (label: string) => SKILL_TERMS[label] || [label.replace(/\s*\(.*\)$/, "").toLowerCase()];

// ---------- sources ----------
async function linkedin(term: string, pages = 2): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let p = 0; p < pages; p++) {
    const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(term)}&geoId=${JORDAN_GEO}&f_TPR=r2592000&start=${p * 10}`);
    if (!html) break;
    const cards = html.split('data-entity-urn="urn:li:jobPosting:').slice(1);
    if (!cards.length) break;
    for (const c of cards) {
      const id = c.match(/^(\d+)/)?.[1]; if (!id) continue;
      const title = clean(c.match(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/)?.[1] || "");
      const company = clean(c.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/)?.[1] || "");
      const location = clean(c.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/)?.[1] || "");
      const posted = c.match(/<time[^>]*datetime="([\d-]+)"/)?.[1] || "";
      if (title && inJordan(location)) jobs.push({ id: `linkedin-${id}`, title, company, location, url: `https://www.linkedin.com/jobs/view/${id}/`, source: "LinkedIn", posted_at: posted, description: "", level: "", work_type: "" });
    }
    await sleep(1500);
  }
  return jobs;
}
async function linkedinDetail(j: Job) {
  const html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${j.id.replace("linkedin-", "")}`, 3);
  if (!html) return;
  j.description = strip(html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/)?.[1] || "");
  const crit: Record<string, string> = {};
  for (const m of html.matchAll(/job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g)) crit[clean(m[1]).toLowerCase()] = clean(m[2]);
  j.level = crit["seniority level"] && crit["seniority level"] !== "Not Applicable" ? crit["seniority level"] : "";
  j.work_type = crit["employment type"] || "";
}
async function akhtaboot(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let p = 1; p <= 3; p++) {
    const html = await get(`https://www.akhtaboot.com/en/jobs/search?page=${p}&per_page=25&search%5Bcp_country_name%5D%5Bvals%5D%5B%5D=Jordan`);
    if (!html) break;
    const blocks = html.split("Ref. Number:").slice(1);
    if (!blocks.length) break;
    for (const b of blocks) {
      const id = b.match(/^\s*(\d+)/)?.[1];
      const href = b.match(/class='job-link' href='([^']+)'/)?.[1];
      const title = clean(b.match(/<h4>([\s\S]*?)<\/h4>/)?.[1] || "");
      const co = b.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] || "";
      const company = clean(co.split("<span>")[0]).replace(/\s*-\s*$/, "");
      const location = clean(co.match(/<span>([\s\S]*?)<\/span>/)?.[1] || "Jordan");
      const d = b.match(/Date Posted:\s*(\d{2})-(\d{2})-(\d{4})/);
      if (id && href && title) jobs.push({ id: `akhtaboot-${id}`, title, company, location, url: `https://www.akhtaboot.com${href}`, source: "Akhtaboot", posted_at: d ? `${d[3]}-${d[2]}-${d[1]}` : "", description: "", level: "", work_type: "" });
    }
    await sleep(1500);
  }
  return jobs;
}
async function akhtabootDetail(j: Job) {
  const html = await get(j.url);
  if (!html) return;
  const body = html.split("Job Description and Requirements")[1] || "";
  j.description = strip(body.split("Company:")[0] || "").slice(0, 8000);
  const meta = strip(body.split("Company:")[1]?.split("Apply Now")[0] || "");
  j.level = meta.match(/Career Level:\s*([^\n]+)/)?.[1]?.trim() || "";
}

// ---------- scoring ----------
// Smallest "N years" the post asks for. Ranges like "2-5" or "2–5" count as their lower end; odd numbers (0, 25) are ignored.
function yearsAsked(d: string): number {
  const ns = [...d.matchAll(/\b(\d{1,2})\s*\+?\s*(?:(?:-|–|—|‑|to)\s*\d{1,2}\s*)?\+?\s*years?\b/g)].map((m) => +m[1]).filter((n) => n >= 1 && n <= 15);
  return ns.length ? Math.min(...ns) : 0;
}
function careerYears(cv: string): number {
  const years = [...cv.matchAll(/\b(19[89]\d|20[0-2]\d)\b/g)].map((m) => +m[1]).filter((y) => y <= new Date().getFullYear());
  return years.length ? new Date().getFullYear() - Math.min(...years) : 0;
}
const LANGS = ["french", "german", "turkish", "italian", "spanish", "russian", "chinese", "mandarin", "hebrew", "japanese", "korean", "portuguese", "dutch", "greek", "persian", "farsi", "urdu", "hindi"];
const LICENSED = /\b(nurse|nursing|physician|doctor|dentist|dental|pharmacist|surgeon|psychologist|engineer|developer|programmer|architect|lawyer|teacher|driver|chef)\b/i;

function score(p: Profile, j: Job, cvYears: number) {
  const text = `${j.title}\n${j.description}`;
  const mine = `${p.roles.join(" ")} ${p.skills.join(" ")} ${p.cv_text}`.toLowerCase();
  const lic = j.title.match(LICENSED)?.[1]?.toLowerCase();
  if (lic && !mine.includes(lic.replace(/ing$/, "").slice(0, 5))) return null;
  if (j.location && !inJordan(j.location) && !/remote/i.test(j.location)) return null;

  const rf = roleFit(p.roles, j.title);
  const skillLabels = [...new Set([...p.skills, ...Object.keys(SKILL_TERMS).filter((l) => has(p.cv_text, SKILL_TERMS[l]))])];
  const matchedSkills = skillLabels.filter((l) => !["Arabic", "English", "Communication"].includes(l) && has(text, termsFor(l)));
  const gaps: string[] = [];
  let pts = 40 * rf.fit + Math.min(30, matchedSkills.length * 5);

  const loc = `${j.location} ${j.description.slice(0, 400)}`.toLowerCase();
  const wanted = (p.locations || "amman").toLowerCase();
  const city = ["amman", "irbid", "zarqa", "aqaba", "salt", "madaba", "karak", "mafraq", "jerash", "ajloun"].find((c) => loc.includes(c));
  if (/remote|work from home/.test(loc) || !city || wanted.includes(city)) pts += 15; else { pts += 8; gaps.push(`Based in ${city[0].toUpperCase() + city.slice(1)}`); }

  const sal = [...j.description.matchAll(/(?:jod|jd|دينار)\s*([\d,]{3,6})|([\d,]{3,6})\s*(?:jod|jd|دينار)/gi)].map((m) => +(m[1] || m[2]).replace(/,/g, "")).filter((n) => n >= 150 && n <= 20000);
  const salary = sal.length ? `JOD ${Math.min(...sal).toLocaleString()}${sal.length > 1 && Math.max(...sal) !== Math.min(...sal) ? " - " + Math.max(...sal).toLocaleString() : ""}` : "";
  if (p.min_salary && sal.length && Math.max(...sal) < p.min_salary) { const r = Math.max(...sal) / p.min_salary; pts += r >= 0.75 ? 8 : 0; gaps.push(`Pays below your ${p.min_salary} JOD minimum`); } else pts += 15;

  const d = j.description.toLowerCase();
  const hasDegree = /bachelor|university|b\.?sc|b\.a\b|degree|diploma|graduat/i.test(p.cv_text);
  const degreeAt = d.search(/bachelor|university degree|b\.?sc\b|degree in|college degree/);
  if (degreeAt >= 0 && !hasDegree) { const preferred = /prefer|plus|advantage|desirable/.test(d.slice(degreeAt, degreeAt + 120)); pts -= preferred ? 3 : 8; gaps.push(preferred ? "Degree preferred" : "Bachelor's degree required"); }
  const need = yearsAsked(d);
  if (need && cvYears && need > cvYears + 1) { pts -= 8; gaps.push(`Asks for ${need}+ years`); }
  for (const lang of LANGS) {
    if (mine.includes(lang)) continue;
    const inTitle = new RegExp(`\\b${lang}\\b`, "i").test(j.title);
    const at = d.search(new RegExp(`\\b${lang}\\b`));
    if (inTitle || (at >= 0 && /fluen|proficien|native|bilingual|speak|required|must/.test(d.slice(Math.max(0, at - 60), at + 60)))) {
      pts -= inTitle ? 35 : 20; gaps.push(`Needs ${lang[0].toUpperCase() + lang.slice(1)}`);
    }
  }
  const TECH = ["sql", "python", "selenium", "test cases", "test automation", "automation testing", "regression testing", "api testing", "postman", "cypress", "jira",
    "machine learning", "etl", "data pipeline", "javascript", "java", "unit test", "qa engineer", "software testing"];
  const tech = TECH.filter((t) => termRe(t).test(d) && !mine.includes(t));
  if (tech.length >= 3) { pts -= tech.length >= 5 ? 35 : 28; gaps.push(`Technical role: ${tech.slice(0, 3).join(", ")}`); }
  const FIELD: [RegExp, string][] = [[/\b(gcp|gmp|clinical|pharmac\w*|laborator\w*|iso 17025|haccp|food safety|medical device)\b/, "pharma/clinical/lab"], [/\b(civil|structural|mechanical|electrical) engineering\b/, "engineering"], [/\b(ifrs|cpa|acca|cma)\b/, "accounting certification"]];
  for (const [re, name] of FIELD) if (re.test(d) && !re.test(mine)) { pts -= 25; gaps.push(`Specialist field: ${name}`); break; }
  if (/own (a )?car|own vehicle|valid driving licen|driver'?s licen/.test(d) && !/driving|licen/.test(mine)) { pts -= 5; gaps.push("Car or driving licence needed"); }
  if (/night shift|overnight|graveyard|us shift|us hours|\b(6|7|8|9|10)\s?pm\b/.test(d)) gaps.push("Night shifts");
  if (!j.description) gaps.push("Couldn't read the full post; open it to check");

  const s = Math.max(0, Math.min(100, Math.round(pts)));
  const fitWord = rf.fit >= 0.95 ? "Exact" : rf.fit >= 0.6 ? "Strong" : rf.fit >= 0.3 ? "Partial" : "Weak";
  const why = `${fitWord} title match for ${rf.role}` + (matchedSkills.length ? `; ${matchedSkills.length} of your skills show up in the post` : "; few of your listed skills appear in the post") + (gaps[0] ? `, but watch out: ${gaps[0].toLowerCase()}` : "") + ".";
  const matched = [...(rf.fit >= 0.6 ? [rf.role] : []), ...matchedSkills].slice(0, 4);
  return { score: s, score_why: why, matched, gaps, salary, fit: rf.fit, matchedSkills };
}

const JUNK = /job number|job category|view on map|located remotely|^schedule\b|^additional information|equal opportunity|apply now|^location\b|^position type\b/i;
const LABEL = /^(position type[^.]*?position summary|position summary|job summary|summary|overview|about the job|job description|job purpose|role purpose)\s*:?\s*/i;
const NOT_DUTY = /\b(cv|resume|apply|application|documents?|passport|id card|screenshot|submit|salary|benefits?|insurance|bonus|we offer|perks?)\b/i;
function summarize(j: Job, need: string[]): string {
  const lines = j.description.replace(/\s+•\s+/g, "\n• ").split("\n").map((l) => l.trim().replace(LABEL, "").trim()).filter((l) => l && !JUNK.test(l));
  const isHead = (l: string) => !l.startsWith("•") && l.length < 70;
  const head = lines.findIndex((l) => isHead(l) && /responsib|duties|what you('|’)?ll do|you will|your role|the role|key tasks|day.to.day|your impact|what you('|’)?ll be doing/i.test(l));
  const bullets: string[] = [];
  for (const l of lines.slice(head >= 0 ? head + 1 : 0)) {
    if (l.startsWith("•")) { const b = l.replace(/^•\s*/, "").replace(/[.;:]$/, ""); if (!NOT_DUTY.test(b) && b.length > 15) bullets.push(b); }
    else if (head >= 0 && bullets.length && isHead(l)) break;
    if (bullets.length >= 3) break;
  }
  let out: string;
  if (bullets.length >= 2) out = "Day to day: " + bullets.slice(0, 3).map((b) => (b.length > 140 ? b.slice(0, 137) + "…" : b)).join("; ") + ".";
  else {
    const sentences = lines.join(" ").replace(/\s+/g, " ").match(/[^.!?]{25,}[.!?]/g) || [];
    out = sentences.slice(0, 2).join(" ").slice(0, 320);
  }
  if (need.length) out += ` They ask for: ${need.join(", ")}.`;
  return out || "Open the post for the full description.";
}
function requirements(j: Job): string[] {
  const d = j.description.toLowerCase(), out: string[] = [];
  const ys = yearsAsked(d); if (ys) out.push(`${ys}+ years' experience`);
  if (/bachelor|university degree|degree in/.test(d)) out.push("a degree");
  const langs = ["english", "arabic", ...LANGS].filter((l) => new RegExp(`\\b${l}\\b`).test(d)); if (langs.length) out.push(langs.map((l) => l[0].toUpperCase() + l.slice(1)).join(" and "));
  return out.slice(0, 3);
}

function drafts(p: Profile, j: Job, matched: string[]) {
  const first = p.name.trim();
  const at = j.company && !/confidential/i.test(j.company) ? ` at ${j.company}` : "";
  const PROPER = /^(Microsoft|PowerPoint|Google|Arabic|English|French|Turkish|German|SAP|QuickBooks|CRM|Zendesk|Power BI|KPI|SLAs)/;
  const sk = matched.slice(0, 3).map((m) => (PROPER.test(m) ? m : m[0].toLowerCase() + m.slice(1)));
  const list = sk.length > 1 ? sk.slice(0, -1).join(", ") + " and " + sk[sk.length - 1] : sk[0] || "the kind of work this role involves";
  const contact = p.contact ? `\n${p.contact}` : "";
  const msg_en = `Hello, I'd like to apply for the ${j.title} role${at}. My experience covers ${list}, which lines up with what you're looking for. My CV has the details, and I'd welcome a short call to talk about how I can help your team.\n\nThank you,\n${first}${contact}`;
  const atAr = j.company && !/confidential/i.test(j.company) ? ` لدى ${j.company}` : "";
  const msg_ar = `مرحباً، أودّ التقدّم لوظيفة ${j.title}${atAr}. خبرتي تشمل ${sk.join("، ") || "العمل مع العملاء"}، وهي تتوافق مع ما تبحثون عنه. تجدون التفاصيل في سيرتي الذاتية، ويسعدني ترتيب مكالمة قصيرة للحديث عن كيف يمكنني دعم فريقكم.\n\nمع الشكر،\n${first}${contact}`;
  const cover = `Dear Hiring Team,\n\nI'm applying for the ${j.title} position${at}. Reading the post, the work you describe is close to what I already do, and I'd like to bring that experience to your team.\n\nThe role calls for ${list}, and these are areas I've worked in directly. My CV sets out where and how, with the results I've delivered.\n\nI'm based in Jordan, available to start on reasonable notice, and comfortable working in both Arabic and English. I'd welcome the chance to discuss how I can contribute.\n\nKind regards,\n${first}${contact}`;
  return { msg_en, msg_ar, cover };
}

// ---------- run one profile ----------
async function run(p: Profile) {
  const terms = [...new Set(p.roles.map((r) => r.replace(/\s*\(.*\)$/, "").split(" / ")[0]))].slice(0, 4);
  const { data: existing } = await db.from("matches").select("id").eq("profile_id", p.id);
  const seen = new Set((existing || []).map((r) => r.id));
  const pool = new Map<string, Job>();
  for (const t of terms) for (const j of await linkedin(t)) if (!pool.has(j.id)) pool.set(j.id, j);
  for (const j of await akhtaboot()) pool.set(j.id, j);

  const fresh = [...pool.values()].filter((j) => !seen.has(j.id));
  const ranked = fresh.map((j) => ({ j, f: roleFit(p.roles, j.title).fit })).filter((x) => x.f >= 0.3).sort((a, b) => b.f - a.f);
  const li = ranked.filter((x) => x.j.source === "LinkedIn").slice(0, 12), ak = ranked.filter((x) => x.j.source === "Akhtaboot").slice(0, 5);
  for (const { j } of li) { await linkedinDetail(j); await sleep(1500); }
  for (const { j } of ak) { await akhtabootDetail(j); await sleep(1200); }

  const cvYears = careerYears(p.cv_text);
  const rows = [];
  for (const { j } of [...li, ...ak]) {
    const s = score(p, j, cvYears);
    if (!s || s.score < MIN_SCORE) continue;
    const row: Record<string, unknown> = {
      profile_id: p.id, id: j.id, title: j.title, company: j.company, location: j.location, work_type: j.work_type, salary: s.salary, level: j.level,
      posted_at: j.posted_at, url: j.url, source: j.source, summary: summarize(j, requirements(j)), score: s.score, score_why: s.score_why, matched: s.matched, gaps: s.gaps,
      msg_en: "", msg_ar: "", cover: "",
      how_to_apply: (j.description.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [""])[0] ? `Email: ${(j.description.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [""])[0]}` : "",
    };
    if (s.score >= 60) Object.assign(row, drafts(p, j, s.matchedSkills));
    rows.push(row);
  }
  rows.sort((a, b) => (b.score as number) - (a.score as number));
  const keep = rows.slice(0, MAX_SAVE);
  if (keep.length) {
    const { error } = await db.from("matches").upsert(keep, { onConflict: "profile_id,id", ignoreDuplicates: true });
    if (error) throw new Error("save failed: " + error.message);
  }
  await db.from("runs").upsert({ profile_id: p.id, last_run_at: new Date().toISOString(), matches_found: keep.length });
  await db.from("profiles").update({ search_started_at: null }).eq("id", p.id);
  return { checked: pool.size, read: li.length + ak.length, saved: keep.length };
}

const FIELDS = "id, name, roles, skills, cv_text, locations, min_salary, contact, search_started_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));

  if (body.next) {
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
    const cutoff = new Date(Date.now() - 20 * 3600e3).toISOString();
    const { data: profiles } = await db.from("profiles").select(FIELDS + ", runs(last_run_at)").eq("active", true);
    const due = (profiles || []).filter((p: any) => !p.runs?.last_run_at || p.runs.last_run_at < cutoff)
      .sort((a: any, b: any) => String(a.runs?.last_run_at || "").localeCompare(String(b.runs?.last_run_at || "")));
    if (!due.length) return json({ status: "nothing_due" });
    return json({ status: "done", ...(await run(due[0] as Profile)) });
  }

  if (typeof body.k !== "string" || !/^[0-9a-f-]{36}$/i.test(body.k)) return json({ status: "not_found" }, 404);
  const { data: p } = await db.from("profiles").select(FIELDS + ", runs(last_run_at)").eq("access_key", body.k).maybeSingle();
  if (!p) return json({ status: "not_found" }, 404);
  const last = (p as any).runs?.last_run_at;
  if (last && Date.now() - new Date(last).getTime() < COOLDOWN_H * 3600e3) return json({ status: "too_soon", next_at: new Date(new Date(last).getTime() + COOLDOWN_H * 3600e3).toISOString() });
  const lock = (p as any).search_started_at;
  if (lock && Date.now() - new Date(lock).getTime() < 4 * 60e3) return json({ status: "running" });
  await db.from("profiles").update({ search_started_at: new Date().toISOString() }).eq("id", (p as any).id);
  try {
    return json({ status: "done", ...(await run(p as unknown as Profile)) });
  } catch (e) {
    await db.from("profiles").update({ search_started_at: null }).eq("id", (p as any).id);
    return json({ status: "error", message: String(e) }, 500);
  }
});
