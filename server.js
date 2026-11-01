const express = require('express');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

let qrCode = null;
let botStatus = 'offline';
let sock = null;

const suspendedGroups = new Set();
const bannedUsers = new Set([
  '+50941021883',
  '50941021883',
  '50941021883@s.whatsapp.net'
]);
const botAdmins = new Set(['276*******@s.whatsapp.net']);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'SUKUNA', status: botStatus, qr: !!qrCode });
});

app.get('/api/status', (req, res) => {
  res.json({ app: 'SUKUNA', status: botStatus, qrCode: qrCode || null, port });
});

app.get('/api/qr', (req, res) => {
  if (!qrCode) return res.json({ ok: false, message: 'QR code not ready yet.' });
  res.json({ ok: true, qr: qrCode });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function normalizePhone(value = '') {
  if (!value) return '';
  return String(value)
    .replace(/\s+/g, '')
    .replace(/\+/g, '')
    .replace(/[^0-9@.]/g, '')
    .toLowerCase();
}

function isBlockedUser(sender = '') {
  const raw = sender || '';
  const normalized = normalizePhone(raw);
  const base = normalizePhone(raw.split('@')[0]);

  return (
    bannedUsers.has(raw) ||
    bannedUsers.has(normalized) ||
    bannedUsers.has(base)
  );
}

async function isGroupAdmin(groupId, userId) {
  if (!sock || !groupId || !userId) return false;
  try {
    const metadata = await sock.groupMetadata(groupId);
    const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
    return admins.includes(userId);
  } catch {
    return false;
  }
}

async function sendStickerFromImage(targetJid, imageBuffer, pack = 'SUKUNA', author = 'V1000') {
  try {
    const sticker = new Sticker(imageBuffer, {
      pack,
      author,
      type: StickerTypes.FULL,
      categories: ['🤖'],
      quality: 80
    });

    const buffer = await sticker.toBuffer();
    await sock.sendMessage(targetJid, { sticker: buffer });
    return true;
  } catch (error) {
    console.error('Sticker error:', error);
    return false;
  }
}

async function handleCommands(msg, from, groupId, messageText, sender) {
  if (!messageText) return;

  const text = messageText.trim();
  const command = text.toLowerCase();

  if (command === '!menu' || command === '/menu' || command === '!help' || command === '/help') {
    const help = `SUKUNA\n\nCommands:\n!menu\n!status\n!suspend\n!resume\n!sticker\n!ban\n!unban\n!kick\n!info`;
    await sock.sendMessage(from, { text: help });
    return;
  }

  if (command === '!status') {
    await sock.sendMessage(from, { text: `Bot status: ${botStatus}` });
    return;
  }

  if ((command === '!suspend' || command === '!suspendgroup') && groupId) {
    const isAdmin = (await isGroupAdmin(groupId, sender)) || botAdmins.has(sender);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: 'Only admin can suspend this group.' });
      return;
    }

    suspendedGroups.add(groupId);
    await sock.sendMessage(from, { text: 'Group suspended. Bot will ignore future messages until resumed.' });
    return;
  }

  if ((command === '!resume' || command === '!resumegroup') && groupId) {
    const isAdmin = (await isGroupAdmin(groupId, sender)) || botAdmins.has(sender);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: 'Only admin can resume this group.' });
      return;
    }

    suspendedGroups.delete(groupId);
    await sock.sendMessage(from, { text: 'Group resumed. Bot active again.' });
    return;
  }

  if ((command === '!kick' || command === '!remove') && groupId) {
    const isAdmin = (await isGroupAdmin(groupId, sender)) || botAdmins.has(sender);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: 'Only admin can kick users.' });
      return;
    }

    const targetRaw = text.split(/\s+/).slice(1).join(' ').trim();
    if (!targetRaw) {
      await sock.sendMessage(from, { text: 'Use: !kick +50941021883 or !kick 50941021883@s.whatsapp.net' });
      return;
    }

    const target = targetRaw.replace(/[^0-9@.]/g, '');
    try {
      await sock.groupParticipantsUpdate(groupId, [target], 'remove');
      bannedUsers.add(normalizePhone(target));
      bannedUsers.add(target);
      await sock.sendMessage(from, { text: `⏱️⏳ ${target} te kite gwoup la.` });
      return;
    } catch (error) {
      console.error('Kick error:', error);
      await sock.sendMessage(from, { text: 'Pa ka kite moun sa soti nan gwoup la.' });
      return;
    }
  }

  if ((command === '!ban' || command === '!bann') && sender) {
    const isAdmin = groupId ? ((await isGroupAdmin(groupId, sender)) || botAdmins.has(sender)) : botAdmins.has(sender);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: 'Only admin can ban users.' });
      return;
    }

    const targetRaw = text.split(/\s+/).slice(1).join(' ').trim();
    const target = targetRaw || sender;
    const normalized = normalizePhone(target);

    bannedUsers.add(target);
    bannedUsers.add(normalized);
    bannedUsers.add(normalizePhone(target.split('@')[0]));

    if (groupId && target !== sender) {
      try {
        const kickTarget = target.includes('@') ? target : `${target}@s.whatsapp.net`;
        await sock.groupParticipantsUpdate(groupId, [kickTarget], 'remove');
      } catch (error) {
        console.error('Auto kick on ban error:', error);
      }
    }

    await sock.sendMessage(from, { text: `⏱️⏳ ${target} te ban. Li pa ka voye mesaj ankò.` });
    return;
  }

  if ((command === '!unban' || command === '!unbann') && sender) {
    const isAdmin = groupId ? ((await isGroupAdmin(groupId, sender)) || botAdmins.has(sender)) : botAdmins.has(sender);
    if (!isAdmin) {
      await sock.sendMessage(from, { text: 'Only admin can unban users.' });
      return;
    }

    const targetRaw = text.split(/\s+/).slice(1).join(' ').trim();
    const target = targetRaw || sender;
    const normalized = normalizePhone(target);

    bannedUsers.delete(target);
    bannedUsers.delete(normalized);
    bannedUsers.delete(normalizePhone(target.split('@')[0]));

    await sock.sendMessage(from, { text: `${target} te de-ban.` });
    return;
  }

  if (command === '!info') {
    await sock.sendMessage(from, {
      text: 'SUKUNA\nType: WhatsApp bot\nFeatures: admin, stickers, suspension, command system\nBan system: active'
    });
    return;
  }
}

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'sessions'));
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    browser: ['SUKUNA', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      botStatus = 'waiting_for_qr';
      console.log('Scan this QR code in WhatsApp:');
      console.log(qr);
    }

    if (connection === 'open') {
      botStatus = 'online';
      qrCode = null;
      console.log('WhatsApp connected successfully.');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      botStatus = 'reconnecting';
      console.log('Connection closed. Reconnecting...');
      if (shouldReconnect) setTimeout(startWhatsAppBot, 2000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      const groupId = from?.endsWith('@g.us') ? from : null;
      const sender = msg.key.participant || msg.key.remoteJid;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      console.log('DEBUG SENDER:', { from, sender, groupId, text });

      if (isBlockedUser(sender)) {
        console.log('BLOCKED USER DETECTED:', sender);
        await sock.sendMessage(from, { text: '⏱️⏳ Ou nan lis bann lan. Ou pa ka voye mesaj ankò.' });
        continue;
      }

      if (groupId && suspendedGroups.has(groupId)) {
        const isAdmin = (await isGroupAdmin(groupId, sender)) || botAdmins.has(sender);
        if (!isAdmin) {
          bannedUsers.add(normalizePhone(sender));
          bannedUsers.add(sender);
          await sock.sendMessage(from, { text: '⏱️⏳ Gwoup sa suspendi. Ou te mete nan lis bann lan otomatikman.' });
          continue;
        }
      }

      await handleCommands(msg, from, groupId, text, sender);

      const imageMessage = msg.message?.imageMessage;
      if (imageMessage) {
        const caption = (msg.message?.imageMessage?.caption || '').trim().toLowerCase();
        if (caption === '!sticker' || caption === '/sticker' || caption === '!s') {
          const media = await downloadMediaMessage(msg, 'buffer', {});
          const ok = await sendStickerFromImage(from, media, 'SUKUNA', 'V1000');
          if (!ok) {
            await sock.sendMessage(from, { text: 'Sticker creation failed.' });
          }
        }
      }
    }
  });

  return sock;
}

app.listen(port, async () => {
  console.log(`SUKUNA server running on http://localhost:${port}`);
  try {
    await startWhatsAppBot();
  } catch (error) {
    console.error('Unable to start WhatsApp bot:', error);
    botStatus = 'error';
  }
});
