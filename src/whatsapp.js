const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const { insertMessage } = require('./supabase');

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || './auth_info';

let sock = null;
let latestQrDataUrl = null;
let connectionState = 'connecting'; // connecting | qr | open | closed

function getStatus() {
  return { state: connectionState, qr: connectionState === 'qr' ? latestQrDataUrl : null };
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    null
  );
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionState = 'qr';
      latestQrDataUrl = await QRCode.toDataURL(qr);
      console.log('New WhatsApp pairing QR generated — open GET /qr on this server to scan it.');
    }

    if (connection === 'open') {
      connectionState = 'open';
      latestQrDataUrl = null;
      console.log('WhatsApp connected.');
    }

    if (connection === 'close') {
      connectionState = 'closed';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log('WhatsApp connection closed.', loggedOut ? '(logged out — delete auth_info and re-scan)' : '(reconnecting…)');
      if (!loggedOut) {
        setTimeout(start, 3000);
      }
    }
  });

  // Live message capture — this is how "previous messages" get accumulated.
  // The bot must be online in each group to capture that day's messages,
  // so keep this service running continuously.
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid;
        if (!jid || !jid.endsWith('@g.us')) continue; // only care about group messages
        const text = extractText(msg);
        if (!text) continue; // skip non-text (stickers, reactions, etc.)

        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderName = msg.pushName || senderJid.split('@')[0];
        const tsMs = (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;

        await insertMessage({
          groupJid: jid,
          sender: senderJid,
          senderName,
          body: text,
          msgTs: new Date(tsMs).toISOString()
        });
      } catch (e) {
        console.error('Error capturing message:', e.message);
      }
    }
  });

  return sock;
}

async function listGroups() {
  if (!sock || connectionState !== 'open') return [];
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups).map(g => ({ jid: g.id, name: g.subject }));
}

module.exports = { start, getStatus, listGroups };
