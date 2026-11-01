# SUKUNA BOT

SUKUNA BOT is a real starter project for a WhatsApp automation bot with a modern landing page and Express backend.

## Features

- Modern landing page
- Express API server
- WhatsApp bot starter using Baileys
- QR-based login flow
- Status endpoint for health checks

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Then open:

```bash
http://localhost:3000
```

You will see the landing page and the WhatsApp QR login flow in the terminal.

## Structure

- `index.html` — landing page
- `server.js` — backend and bot logic
- `package.json` — project metadata and deps
- `.env.example` — environment variables
- `sessions/` — WhatsApp auth session data

## Notes

This is a starter template to build a real WhatsApp bot. The QR scan is required to connect the bot to WhatsApp.

## License

MIT
