'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
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
      // Prefer explicit credentials from env if provided; otherwise fall back to default ADC.
      const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      let credential = null;

      if (serviceAccountJson) {
        try {
          const parsed = JSON.parse(serviceAccountJson);
          credential = admin.credential.cert(parsed);
          // eslint-disable-next-line no-console
          console.log('[Auth] Using FIREBASE_SERVICE_ACCOUNT env for credentials.');
        } catch (parseErr) {
          // eslint-disable-next-line no-console
          console.warn('[Auth] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON, falling back to other methods.', parseErr);
        }
      }

      if (!credential) {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        if (projectId && clientEmail && privateKey) {
          credential = admin.credential.cert({
            projectId,
            clientEmail,
            // Replace literal '\n' with real newlines if the key is stored in a single-line env var.
            privateKey: privateKey.replace(/\\n/g, '\n'),
          });
          // eslint-disable-next-line no-console
          console.log('[Auth] Using FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars for credentials.');
        }
      }

      if (credential) {
        admin.initializeApp({ credential });
      } else {
        // As a last resort, rely on default application credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS).
        admin.initializeApp();
        // eslint-disable-next-line no-console
        console.log('[Auth] Initialized firebase-admin with default application credentials.');
      }
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

// Basic rate limiting to protect upload and webhook endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Multer temp storage with simple video-only filter
const upload = multer({
  dest: path.join(require('os').tmpdir(), 'uploads'),
  limits: {
    fileSize: 1024 * 1024 * 500, // 500MB cap
  },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isVideoMime = mime.startsWith('video/');
    const allowedExt = ['.mp4', '.mov', '.m4v', '.webm'];
    if (isVideoMime || allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  },
});

const PRIMARY_BASE = 'https://video.bunnycdn.com/library';
const basicAuthHeader =
  'Basic ' + Buffer.from(`${LIB_ID}:${STREAM_KEY}`).toString('base64');

// Helper: fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(id);
  }
}

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
    const createResp = await fetchWithTimeout(`${PRIMARY_BASE}/${LIB_ID}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AccessKey: STREAM_KEY,
        Authorization: basicAuthHeader,
      },
      body: JSON.stringify({ title }),
    }, 30000);
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
    const uploadResp = await fetchWithTimeout(`${PRIMARY_BASE}/${LIB_ID}/videos/${guid}`, {
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
    }, 5 * 60 * 1000); // 5 minutes timeout for large uploads
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
