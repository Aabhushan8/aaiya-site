// Aaiya Solutions — demo chatbot backend as a Cloudflare Pages Function (v1.0)
// File location in repo: functions/api/chat.js  →  served at POST /api/chat
//
// Pages dashboard → Settings → Environment variables (Production):
//   GOOGLE_API_KEY   required — free key from https://aistudio.google.com
//   LLM_MODEL        optional — default "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-3-flash"
//   DAILY_BUDGET_USD optional — default 5
// Pages dashboard → Settings → Functions → KV namespace bindings:
//   Variable name: CHAT_LIMITS  (create a namespace, e.g. "chat-limits")
//
// Protections: input validation, per-IP rate limit (20/min), per-session daily
// cap (100/day), daily $5 spend kill-switch, KB-grounded answers with fixed
// "I'm not sure…" fallback. Counters live in KV (in-memory fallback per isolate).

const MAX_MSG_LEN = 500;
const RATE_PER_MIN = 20;
const SESSION_DAILY_MAX = 100;
const COST_PER_1K = 0.0006;
const FALLBACK =
  "I'm not sure about that — let me connect you with the team and they'll get back to you shortly.";

// Knowledge base is inlined so the function works however it is bundled.
const KB = {"business_name":"Aaiya Solutions","entries":[{"answer":"We build three things: an AI Chatbot for your existing site ($349), a Chatbot + brand-new Website ($799), or a Website Redesign + Chatbot ($899). All one-time pricing, no subscriptions.","question":"What services do you offer?"},{"answer":"Chatbot alone is $349, Chatbot + Website is $799, and Redesign + Chatbot is $899 — all one-time. You pay 50% to start and 50% when it goes live.","question":"How much does it cost?"},{"answer":"Typically about 7 days from your approval to launch. A chatbot on an existing site can be even faster.","question":"How long does it take?"},{"answer":"1) We study your business. 2) You see a free live demo in your branding. 3) You pay 50% and we build (about 7 days). 4) It goes live and you pay the final 50%.","question":"How does the process work?"},{"answer":"No website? No problem — our $799 package includes a complete new website with the chatbot built in. If you have a site, we can add the chatbot ($349) or redesign it ($899).","question":"Do I need a website already?"},{"answer":"Yes — we can build your website and chatbot in other languages on request. Just tell us which ones.","question":"Can it work in other languages?"},{"answer":"You can reach us at aabhushanghimire1@gmail.com. Tell us about your business and we will prepare a free demo in your branding.","question":"How do I contact you?"},{"answer":"Our chatbots only answer from your real business information. When the bot does not know something, it says so and connects the visitor with your team — it never invents prices or promises.","question":"Will the chatbot make things up?"},{"answer":"There are no monthly fees. You pay once (50% to start, 50% on delivery) and you own everything.","question":"Are there really no monthly fees?"},{"answer":"Aaiya Solutions is a small studio building AI chatbots and websites for local businesses. One-time pricing, personal service, based in Kathmandu, Nepal — serving clients worldwide.","question":"Who is Aaiya Solutions?"}]};

function systemPrompt() {
  const lines = (KB.entries || [])
    .map((e) => `- ${e.question}: ${e.answer}`)
    .join("\n");
  return (
    `You are the customer-service chatbot for ${KB.business_name}. ` +
    `Answer ONLY using the business information below. ` +
    `If the answer is not in the information, say exactly: "${FALLBACK}" ` +
    `Never invent prices, opening hours, medical or legal advice, or promises. ` +
    `Keep replies under 80 words, friendly, plain language.\n\n` +
    `BUSINESS INFORMATION:\n${lines}`
  );
}

// ------------------------------------------------------------ counters (KV)
const mem = new Map();
async function kvGet(env, key) {
  try {
    if (env.CHAT_LIMITS) {
      const v = await env.CHAT_LIMITS.get(key, "json");
      if (v) return v;
    }
  } catch { /* fall through to memory */ }
  return mem.get(key) || null;
}
async function kvPut(env, key, val, ttlSec) {
  try {
    if (env.CHAT_LIMITS) {
      await env.CHAT_LIMITS.put(key, JSON.stringify(val), { expirationTtl: ttlSec });
      return;
    }
  } catch { /* fall through to memory */ }
  mem.set(key, val);
}
async function bump(env, key, windowMs) {
  const now = Date.now();
  let rec = await kvGet(env, key);
  if (!rec || now - rec.t > windowMs) rec = { t: now, n: 0 };
  rec.n += 1;
  await kvPut(env, key, rec, Math.ceil(windowMs / 1000) + 60);
  return rec.n;
}
async function getSpend(env, day) {
  const rec = await kvGet(env, "spend:" + day);
  return rec?.usd || 0;
}
async function addSpend(env, day, amount) {
  const total = (await getSpend(env, day)) + amount;
  await kvPut(env, "spend:" + day, { usd: total }, 90000);
}

// ------------------------------------------------------------ helpers
const HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: HEADERS });
function cleanMsg(v) {
  if (typeof v !== "string") return null;
  const m = v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
  return m && m.length <= MAX_MSG_LEN ? m : null;
}
function cleanSid(v) {
  if (typeof v !== "string") return "anon";
  return (v.replace(/[^a-zA-Z0-9_-]/g, "") || "anon").slice(0, 64);
}

// ------------------------------------------------------------ handler
export async function onRequestPost(context) {
  const { request, env } = context;
  const GOOGLE_API_KEY = env.GOOGLE_API_KEY || "";
  const LLM_MODELS = (env.LLM_MODEL || "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-3-flash")
    .split(",").map((m) => m.trim()).filter(Boolean);
  const DAILY_BUDGET_USD = parseFloat(env.DAILY_BUDGET_USD || "5");

  if (!GOOGLE_API_KEY)
    return json({ error: "Chat backend not configured (missing API key)." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const message = cleanMsg(body.message);
  if (!message) return json({ error: `Message must be 1–${MAX_MSG_LEN} characters.` }, 400);
  const sid = cleanSid(body.session_id);
  const ip = (request.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);

  const day = new Date().toISOString().slice(0, 10);
  if ((await bump(env, `rl:${ip}:${Math.floor(Date.now() / 60000)}`, 65000)) > RATE_PER_MIN)
    return json({ error: "Too many requests — please slow down." }, 429);
  if ((await bump(env, `sess:${sid}:${day}`, 86400000)) > SESSION_DAILY_MAX)
    return json({ error: "Daily chat limit reached for this session." }, 429);

  const sys = systemPrompt();
  const estTokens = Math.ceil((sys.length + message.length) / 3) + 300;
  const estCost = (estTokens / 1000) * COST_PER_1K;
  if ((await getSpend(env, day)) + estCost > DAILY_BUDGET_USD)
    return json({
      reply: "Our chat assistant is resting for today — please contact us directly and we'll help!",
    });

  let resp = null;
  for (const model of LLM_MODELS) {
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": GOOGLE_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: sys }] },
            contents: [{ parts: [{ text: message }] }],
            generationConfig: { maxOutputTokens: 300, temperature: 0.2 },
          }),
        }
      );
    } catch (e) {
      console.error(`gemini fetch error (${model}): ${e?.message || e}`);
      continue;
    }
    if (resp.ok) break;
    const errBody = await resp.text().catch(() => "");
    console.error(`gemini upstream failed: model=${model} HTTP ${resp.status} msg=${errBody.slice(0, 300)}`);
    if (resp.status !== 404) break;
    resp = null;
  }
  if (!resp || !resp.ok)
    return json({ reply: "Sorry — the chat service had a hiccup. Please try again in a bit." }, 502);

  const data = await resp.json().catch(() => null);
  const reply =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || FALLBACK;

  await addSpend(env, day, estCost);
  return json({ reply });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}
