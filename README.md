# WhatsApp Report Bot

Pulls each team member's daily report messages from their personal WhatsApp
group, filters out small talk with Llama (via Groq, free), and — after an
admin reviews it in the tracker app — saves the summary into the same
Supabase database your Team Report Tracker uses.

**Important:** this connects to WhatsApp using an unofficial library
(Baileys), the same way WhatsApp Web works. It is not Meta's official API,
and using it technically breaks WhatsApp's Terms of Service. Keep this to
light, internal use to keep risk to the connected number low.

## Everything is now driven from the tracker app itself

You no longer need curl for day-to-day use. Once this backend is deployed:

1. Open the tracker → **Team & Data → WhatsApp Automation** → paste this
   backend's URL and your `ADMIN_TOKEN` → **Save**.
2. Click **Test Connection** to confirm it can reach the bot.
3. Click **Load WhatsApp Groups & Mapping** → pick each person's group from
   the dropdown next to their name. That's the mapping done — no curl.
4. Go to **Analytics → Pull & Summarize from WhatsApp** → pick a date →
   **Pull & Draft Summaries**. Review/edit each person's draft, tick the ones
   you want, and hit **Save Selected**. They show up exactly like a manual
   submission.

## Setup (one-time)

### 1. Database
Run `schema.sql` in Supabase → SQL Editor. Adds `whatsapp_groups` and
`whatsapp_messages`, both locked to the service-role key only — the
tracker's public anon key can never touch them.

### 2. Deploy to Railway
1. Push this folder to its own GitHub repo (root of the repo, not nested in
   a subfolder — `package.json` must sit at the repo root).
2. Railway → New Project → Deploy from GitHub repo → pick it.
3. Add a **Volume** mounted at `/app/auth_info` (keeps your WhatsApp login
   across restarts/redeploys).
4. Add variables from `.env.example`: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (service role, not anon), `GROQ_API_KEY`,
   `GROQ_MODEL`, `ADMIN_TOKEN` (make up a long random string).
5. Settings → Networking → Generate Domain, to get a public URL.
6. Open `https://your-app.up.railway.app/qr` and scan it with **WhatsApp →
   Linked Devices → Link a Device**.

### 3. Add the bot to each report group
The connected WhatsApp number needs to be a participant in each person's
report group. If you connected your own personal number and you're already
in every group as the admin, this step is already done.

### 4. Map groups to people, and pull your first summary
Do this from the tracker app as described above (Team & Data → WhatsApp
Automation → Load Groups & Mapping, then Analytics → Pull & Summarize).

## Notes on limitations

- The bot only captures messages sent **while it's online and connected** —
  it can't retroactively pull history from before you connected it. Keep
  the Railway service running continuously.
- If the connected number gets logged out, re-scan `/qr`.
- Groq's free tier has generous rate limits — nowhere near an issue for a
  team summarized once a day.
- Only messages from groups you've explicitly mapped are ever stored —
  everything else the bot can technically see (other chats it happens to be
  in) is ignored.
