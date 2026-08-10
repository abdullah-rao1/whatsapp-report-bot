if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}
require('dotenv').config();

require('dotenv').config();
const express = require('express');
const whatsapp = require('./whatsapp');
const { summarizeDayMessages } = require('./summarize');
const db = require('./supabase');

const app = express();
app.use(express.json());

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.warn('WARNING: ADMIN_TOKEN is not set — every endpoint is unprotected. Set it in .env before going live.');
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next(); // dev-mode fallback
  const token = req.header('x-admin-token');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Missing or invalid x-admin-token header' });
  next();
}

/* ---------------- Status / pairing ---------------- */
app.get('/health', (req, res) => {
  res.json({ ok: true, whatsapp: whatsapp.getStatus().state });
});

// Human-friendly page to scan the QR from a browser (open this on first setup)
app.get('/qr', (req, res) => {
  const { state, qr } = whatsapp.getStatus();
  if (state === 'open') {
    return res.send('<h2>✅ WhatsApp is already connected.</h2>');
  }
  if (state === 'qr' && qr) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h2>Scan this with WhatsApp → Linked Devices</h2>
        <img src="${qr}" style="width:280px;height:280px;" />
        <p>This page refreshes every 5 seconds until connected.</p>
        <script>setTimeout(()=>location.reload(), 5000);</script>
      </body></html>
    `);
  }
  return res.send('<h2>Waiting for a QR code to be generated… refreshing.</h2><script>setTimeout(()=>location.reload(), 3000);</script>');
});

/* ---------------- Group discovery & mapping (admin only) ---------------- */
app.get('/groups', requireAdmin, async (req, res) => {
  try {
    const groups = await whatsapp.listGroups();
    res.json({ groups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/group-mapping', requireAdmin, async (req, res) => {
  try {
    const [members, mappings] = await Promise.all([db.getMembers(), db.getGroupMappings()]);
    const byMember = Object.fromEntries(mappings.map(m => [m.member_id, m]));
    const combined = members.map(m => ({
      memberId: m.id,
      memberName: m.name,
      groupJid: byMember[m.id]?.group_jid || null,
      groupName: byMember[m.id]?.group_name || null
    }));
    res.json({ mappings: combined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/group-mapping', requireAdmin, async (req, res) => {
  try {
    const { memberId, groupJid, groupName } = req.body;
    if (!memberId || !groupJid) return res.status(400).json({ error: 'memberId and groupJid are required' });
    await db.upsertGroupMapping(memberId, groupJid, groupName);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/group-mapping/:memberId', requireAdmin, async (req, res) => {
  try {
    await db.deleteGroupMapping(req.params.memberId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- Pull & summarize (preview only — does not save) ---------------- */
app.post('/pull-summary', requireAdmin, async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });

    const [members, mappings] = await Promise.all([db.getMembers(), db.getGroupMappings()]);
    const mapByMember = Object.fromEntries(mappings.map(m => [m.member_id, m]));

    const results = [];
    for (const member of members) {
      const mapping = mapByMember[member.id];
      if (!mapping) {
        results.push({ memberId: member.id, memberName: member.name, mapped: false });
        continue;
      }
      const msgs = await db.getMessagesForGroupOnDate(mapping.group_jid, date);
      try {
        const summary = await summarizeDayMessages(member.name, date, msgs);
        results.push({
          memberId: member.id,
          memberName: member.name,
          mapped: true,
          groupName: mapping.group_name,
          ...summary
        });
      } catch (e) {
        results.push({ memberId: member.id, memberName: member.name, mapped: true, error: e.message, messageCount: msgs.length });
      }
    }

    res.json({ date, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- Save reviewed/edited summaries into report_days ---------------- */
app.post('/save-reports', requireAdmin, async (req, res) => {
  try {
    const { date, items } = req.body;
    if (!date || !Array.isArray(items)) return res.status(400).json({ error: 'date and items[] are required' });

    const entries = {};
    for (const item of items) {
      if (!item.memberId) continue;
      entries[item.memberId] = {
        submitted: true,
        mode: item.mode || '',
        hours: item.hours || '',
        report: item.report || ''
      };
    }
    await db.saveReportEntries(date, entries);
    res.json({ ok: true, saved: Object.keys(entries).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp report bot listening on port ${PORT}`);
  whatsapp.start().catch(e => console.error('Failed to start WhatsApp connection:', e));
});
