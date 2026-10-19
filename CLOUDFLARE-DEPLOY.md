# Deploy site + AI chatbot on Cloudflare — FREE, no credits to run out of

Cloudflare Pages hosts your site, and Pages Functions run the chatbot —
one GitHub repo, one deploy, same as Netlify. Free tier: 100k function calls/day.

## What you need (all free)
- GitHub account (you have the `aaiya-site` repo already)
- Cloudflare account (dash.cloudflare.com — free signup)
- Your Google AI Studio API key

## Step 1 — add the function to your GitHub repo (3 min)
1. In your `aaiya-site` repo, upload the **`functions`** folder from this zip
   (keep the path: `functions/api/chat.js`). GitHub web: **Add file → Upload files**.
2. That's it — site files (`index.html` etc.) are already there. Commit.

## Step 2 — create the Pages project (5 min)
1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Import an existing Git repository**.
2. Select `aaiya-site`. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `.`
3. **Save and Deploy**. You get `https://<name>.pages.dev`.

## Step 3 — add the API key (your env variable)
1. Pages project → **Settings** → **Environment variables** → **Add variable** (Production).
2. Name: `GOOGLE_API_KEY` — Value: your AI Studio key → **Save**.

## Step 4 — add the KV store (for rate limits)
1. Pages project → **Settings** → **Functions** → **KV namespace bindings** → **Add binding**.
2. Variable name: `CHAT_LIMITS` → **Create a namespace** (call it `chat-limits`) → **Add**.
3. **Deployments** → latest → **⋯ → Retry deployment** (so it picks up the key + KV).

## Step 5 — tell Warrior the new URL
Warrior tests the live AI chat end-to-end (real messages, rate limits, fallback)
and confirms everything works.

## Notes
- The widget calls `/api/chat` on the same domain — no CORS setup needed.
- Free tier: 100,000 function calls/day, 20 AI chats/day on the Gemini free tier
  (then the bot politely rests until tomorrow).
- The old Netlify site can be deleted whenever you like.
