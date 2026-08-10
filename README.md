# WhatsApp Report Bot

Pulls each team member's daily report messages from their personal WhatsApp
group, filters out small talk with Llama (via Groq, free), and — after you
review it — saves the summary into the same Supabase database your Team
Report Tracker uses.

**Important:** this connects to WhatsApp using an unofficial library
(Baileys), the same way WhatsApp Web works. It is not Meta's official API,
and using it technically breaks WhatsApp's Terms of Service. Keep this to
light, internal use — one message a day per group, from groups you already
run — to keep risk to the connected number low. Consider using a spare
number rather than your personal one.

## 1. What you need

- A Supabase project (the same one the tracker app uses)
- A free [Groq](https://console.groq.com/keys) API key (for Llama)
- A [Railway](https://railway.app) account (free tier is enough)
- A WhatsApp number to connect (a spare number is safer than your own)

## 2. Set up the database

In Supabase → SQL Editor, run `schema.sql` from this folder. It adds two
tables (`whatsapp_groups`, `whatsapp_messages`) that only this backend can
touch — they're separate from the tables the tracker's anon key can reach,
so nothing here is exposed to the public website.

## 3. Deploy to Railway

1. Push this folder to its own GitHub repo (keep it separate from the
   tracker's Netlify repo).
2. In Railway: **New Project → Deploy from GitHub repo** → pick this repo.
3. Add a **Volume** mounted at `/app/auth_info` — this is what keeps your
   WhatsApp login saved across deploys/restarts. Without it you'll have to
   re-scan the QR code every time Railway redeploys.
4. In Railway → Variables, add everything from `.env.example`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Service Role key, from
     Supabase → Project Settings → API — **not** the anon key)
   - `GROQ_API_KEY`, `GROQ_MODEL` (default is fine)
   - `ADMIN_TOKEN` — make up a long random string, you'll need it in step 5
5. Deploy. Once it's running, open `https://your-app.up.railway.app/qr` in
   a browser, and scan the QR code with **WhatsApp → Linked Devices → Link a
   Device** on the number you're connecting.
6. Refresh the page — once connected it'll say "WhatsApp is already
   connected."

The bot now silently listens to every group that number is in. It only
**stores** messages from groups you've explicitly mapped (next step) — it
ignores everything else.

## 4. Map each person to their WhatsApp group

Add the connected number to each person's report group (as a normal
participant — it just needs to be in the group to read messages). Then map
each group to the matching team member. You can do this with curl, or I can
add a small settings page for this in the tracker app if you'd like:

```bash
# 1. See groups the bot is in, and their JIDs
curl https://your-app.up.railway.app/groups \
  -H "x-admin-token: YOUR_ADMIN_TOKEN"

# 2. Map a group to a member (memberId must match the tracker's member id,
#    e.g. "roshan" — check Settings > Manage Team Members in the tracker)
curl -X POST https://your-app.up.railway.app/group-mapping \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"memberId":"roshan","groupJid":"1203...@g.us","groupName":"Roshan Reports"}'
```

## 5. Pull a day's summaries

```bash
curl -X POST https://your-app.up.railway.app/pull-summary \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-10"}'
```

This returns a **preview** per person (it does not save anything yet):

```json
{ "date": "2026-08-10", "results": [
  { "memberId": "roshan", "memberName": "Roshan", "mapped": true,
    "report": "Worked on the API rate-limit fix...", "hours": "7", "mode": "Remote", "messageCount": 12 }
]}
```

Review/edit the text, then save the ones you're happy with:

```bash
curl -X POST https://your-app.up.railway.app/save-reports \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-10","items":[
    {"memberId":"roshan","report":"Worked on the API rate-limit fix...","hours":"7","mode":"Remote"}
  ]}'
```

Once saved, it shows up in the tracker exactly like a normal manual
submission.

## 6. Wire it into the tracker's UI (recommended)

Rather than using curl by hand every day, I can add a **"Pull & Summarize
from WhatsApp"** button to the tracker's Analytics/Settings page that calls
this backend, shows each person's draft summary for you to edit, and saves
the ones you approve — with the `ADMIN_TOKEN` and this server's URL entered
once in Settings, the same way the Gemini key works today. Say the word and
I'll add it.

## Notes on limitations

- The bot only captures messages sent **while it's online and connected**.
  It can't retroactively pull WhatsApp history from before you connected it
  — keep the Railway service running continuously.
- If the connected number gets logged out (e.g. logged in on the phone and
  it kicks the linked device), you'll need to re-scan `/qr`.
- Groq's free tier has rate limits (a few thousand requests/day) — for a
  team of a dozen people summarized once a day, you're nowhere near them.
