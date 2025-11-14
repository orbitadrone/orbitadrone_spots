'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const LIB_ID = process.env.BUNNY_LIBRARY_ID;
const STREAM_KEY = process.env.BUNNY_STREAM_API_KEY;
const CDN_HOST = (process.env.BUNNY_CDN_HOST || '').replace(/\/$/, '');
const FIREBASE_AUTH_REQUIRED = String(process.env.FIREBASE_AUTH_REQUIRED || 'true').toLowerCase() !== 'false';

if (!LIB_ID || !STREAM_KEY || !CDN_HOST) {
  // eslint-disable-next-line no-console
  console.error('[Config] Missing required Bunny env vars. Check .env');
}

// Initialize firebase-admin only when auth is required.
let verifyIdToken = async () => ({ sub: 'anonymous' });
if (FIREBASE_AUTH_REQUIRED) {
  try {
    if (!admin.apps || admin.apps.length === 0) {
      admin.initializeApp();
    }
    verifyIdToken = async (authHeader) => {
      if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
        const err = new Error('Missing Authorization header');
        err.status = 401;
        throw err;
      }
      const token = authHeader.slice(7);
      return await admin.auth().verifyIdToken(token);
    };
    // eslint-disable-next-line no-console
    console.log('[Auth] Firebase Admin initialized.');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[Auth] Failed to initialize firebase-admin. Set FIREBASE_AUTH_REQUIRED=false to bypass during local dev.', e);
  }
}

const app = express();
// Parse JSON for non-multipart endpoints (e.g., webhooks)
app.use(express.json({ limit: '1mb' }));

// Multer temp storage
const upload = multer({
  dest: path.join(require('os').tmpdir(), 'uploads'),
  limits: {
    fileSize: 1024 * 1024 * 500, // 500MB cap
  },
});

const PRIMARY_BASE = 'https://video.bunnycdn.com/library';
const basicAuthHeader =
  'Basic ' + Buffer.from(`${LIB_ID}:${STREAM_KEY}`).toString('base64');

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Optional: Bunny webhook receiver (set this URL in Bunny dashboard)
app.post('/bunny/webhook', async (req, res) => {
  try {
    // Example payload fields: event, videoGuid, status, message
    const payload = req.body || {};
    // eslint-disable-next-line no-console
    console.log('[Webhook] Bunny event', payload);
    // TODO: verify signature if configured; update DB if needed.
    return res.status(200).json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Webhook] failed', e);
    return res.status(500).json({ error: String(e) });
  }
});

app.post('/bunny/upload', upload.single('file'), async (req, res) => {
  try {
    if (FIREBASE_AUTH_REQUIRED) {
      await verifyIdToken(req.get('authorization'));
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file required' });
    }
    const titleRaw = typeof req.body.title === 'string' ? req.body.title : '';
    const title = (titleRaw || `Upload ${new Date().toISOString()}`).trim();

    // 1) Create video entry
    const createResp = await fetch(`${PRIMARY_BASE}/${LIB_ID}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AccessKey: STREAM_KEY,
        Authorization: basicAuthHeader,
      },
      body: JSON.stringify({ title }),
    });
    if (!createResp.ok) {
      const txt = await createResp.text().catch(() => '');
      return res.status(createResp.status).send(txt || 'create video failed');
    }
    const created = await createResp.json();
    const guid = created.guid;
    if (!guid) {
      return res.status(502).json({ error: 'no guid from Bunny' });
    }

    // 2) Upload file stream
    const stream = fs.createReadStream(req.file.path);
    const uploadResp = await fetch(`${PRIMARY_BASE}/${LIB_ID}/videos/${guid}`, {
      method: 'PUT',
      headers: {
        AccessKey: STREAM_KEY,
        Authorization: basicAuthHeader,
        'Content-Type': req.file.mimetype || 'application/octet-stream',
        Accept: 'application/json',
      },
      body: stream,
      // Needed for streaming in Node 18 fetch
      duplex: 'half',
    });
    fs.unlink(req.file.path, () => {});

    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => '');
      return res.status(uploadResp.status).send(txt || 'upload failed');
    }

    return res.json({
      guid,
      playbackUrl: `${CDN_HOST}/${guid}/playlist.m3u8`,
    });
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? e.status : 500;
    // eslint-disable-next-line no-console
    console.error('[Upload] failure', e);
    return res.status(status || 500).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[Server] Bunny upload API listening on :${PORT}`);
});
