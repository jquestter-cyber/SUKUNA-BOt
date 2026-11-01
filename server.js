const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

let qrCode = null;
let botStatus = 'offline';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'SUKUNA BOT',
    status: botStatus,
    qr: qrCode ? true : false
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    app: 'SUKUNA BOT',
    status: botStatus,
    qrCode: qrCode || null,
    port
  });
});

app.get('/api/qr', (req, res) => {
  if (!qrCode) {
    return res.json({ ok: false, message: 'QR code not ready yet.' });
  }

  res.json({ ok: true, qr: qrCode });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function startWhatsAppBot() {
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');

  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'sessions'));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    browser: ['SUKUNA BOT', 'Chrome', '1.0.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      botStatus = 'waiting_for_qr';
      console.log('Scan this WhatsApp QR code using your phone:');
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
      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 2000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const sender = msg.key.remoteJid;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      if (!text) continue;

      const reply = `SUKUNA BOT a resevwa mesaj la: "${text}"\n\nMwen prep pou edew. `;
      await sock.sendMessage(sender, { text: reply });
    }
  });

  return sock;
}

app.listen(port, async () => {
  console.log(`SUKUNA BOT server running on http://localhost:${port}`);
  try {
    await startWhatsAppBot();
  } catch (error) {
    console.error('Unable to start WhatsApp bot:', error);
    botStatus = 'error';
  }
});
