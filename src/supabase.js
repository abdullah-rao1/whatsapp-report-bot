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

// Fetch all captured messages for a group on a given local calendar date (YYYY-MM-DD)
async function getMessagesForGroupOnDate(groupJid, dateStr) {
  const startIso = `${dateStr}T00:00:00.000Z`;
  const endIso = `${dateStr}T23:59:59.999Z`;
  const { data, error } = await sb
    .from('whatsapp_messages')
    .select('sender, sender_name, body, msg_ts')
    .eq('group_jid', groupJid)
    .gte('msg_ts', startIso)
    .lte('msg_ts', endIso)
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
