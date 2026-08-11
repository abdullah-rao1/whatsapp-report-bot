const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example)');
}

// Service-role client: bypasses RLS. Only ever used server-side.
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/* ---------------- Team members (same table the tracker app uses) ---------------- */
async function getMembers() {
  const { data, error } = await sb.from('app_settings').select('value').eq('key', 'members').maybeSingle();
  if (error) throw error;
  return (data && Array.isArray(data.value)) ? data.value : [];
}

/* ---------------- Group <-> member mapping ---------------- */
async function getGroupMappings() {
  const { data, error } = await sb.from('whatsapp_groups').select('member_id, group_jid, group_name');
  if (error) throw error;
  return data || [];
}

async function upsertGroupMapping(memberId, groupJid, groupName) {
  const { error } = await sb
    .from('whatsapp_groups')
    .upsert({ member_id: memberId, group_jid: groupJid, group_name: groupName || null }, { onConflict: 'member_id' });
  if (error) throw error;
}

async function deleteGroupMapping(memberId) {
  const { error } = await sb.from('whatsapp_groups').delete().eq('member_id', memberId);
  if (error) throw error;
}

/* ---------------- Raw captured WhatsApp messages ---------------- */
async function insertMessage({ groupJid, sender, senderName, body, msgTs }) {
  const { error } = await sb.from('whatsapp_messages').insert({
    group_jid: groupJid,
    sender,
    sender_name: senderName || null,
    body,
    msg_ts: msgTs
  });
  if (error) console.error('Failed to store WhatsApp message:', error.message);
}

// ---- Reporting-day window ----
// A "day" for message-pulling purposes runs 11:00 AM to 10:59:59 AM the next
// day, Pakistan Standard Time (UTC+5, no daylight saving). Both are
// configurable via env vars if the workday start time or timezone ever change.
const REPORT_DAY_START_HOUR = Number(process.env.REPORT_DAY_START_HOUR ?? 11);
const REPORT_TZ_OFFSET_HOURS = Number(process.env.REPORT_TZ_OFFSET_HOURS ?? 5); // Asia/Karachi = UTC+5

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Converts "11:00 AM on dateStr, local PKT" into the equivalent UTC instant.
function localHourToUtcIso(dateStr, hour) {
  const utcHour = hour - REPORT_TZ_OFFSET_HOURS; // e.g. 11 AM PKT = 06:00 UTC
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCHours(d.getUTCHours() + utcHour);
  return d.toISOString();
}

// Fetch all captured messages for a "reporting day" that starts at
// REPORT_DAY_START_HOUR on dateStr and ends just before REPORT_DAY_START_HOUR
// on the following day (both in Pakistan time).
async function getMessagesForGroupOnDate(groupJid, dateStr) {
  const startIso = localHourToUtcIso(dateStr, REPORT_DAY_START_HOUR);
  const endIso = localHourToUtcIso(addDays(dateStr, 1), REPORT_DAY_START_HOUR); // exclusive upper bound
  const { data, error } = await sb
    .from('whatsapp_messages')
    .select('sender, sender_name, body, msg_ts')
    .eq('group_jid', groupJid)
    .gte('msg_ts', startIso)
    .lt('msg_ts', endIso)
    .order('msg_ts', { ascending: true });
  if (error) throw error;
  return data || [];
}

/* ---------------- report_days (same table the tracker app writes to) ---------------- */
async function saveReportEntries(dateStr, entries) {
  // entries: { [memberId]: { submitted, mode, hours, report } }
  const { data: existing, error: readErr } = await sb
    .from('report_days')
    .select('data')
    .eq('report_date', dateStr)
    .maybeSingle();
  if (readErr) throw readErr;

  const merged = Object.assign({}, existing ? existing.data : {}, entries);

  const { error: writeErr } = await sb
    .from('report_days')
    .upsert({ report_date: dateStr, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'report_date' });
  if (writeErr) throw writeErr;
}

module.exports = {
  sb,
  getMembers,
  getGroupMappings,
  upsertGroupMapping,
  deleteGroupMapping,
  insertMessage,
  getMessagesForGroupOnDate,
  saveReportEntries
};
