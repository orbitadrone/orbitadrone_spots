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
const BUNNY_WEBHOOK_TOKEN = (process.env.BUNNY_WEBHOOK_TOKEN || '').trim();
const FIREBASE_AUTH_REQUIRED = String(process.env.FIREBASE_AUTH_REQUIRED || 'true').toLowerCase() !== 'false';
const UPLOAD_TIMEOUT_MS = Number(process.env.BUNNY_UPLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const BUNNY_GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!LIB_ID || !STREAM_KEY || !CDN_HOST) {
  console.error('[Config] Missing required Bunny env vars. Check .env');
}

// Initialize firebase-admin only when auth is required.
let authReady = !FIREBASE_AUTH_REQUIRED;
let verifyIdToken = async () => {
  const err = new Error('Auth not initialized');
  err.status = 503;
  throw err;
};
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
          console.log('[Auth] Using FIREBASE_SERVICE_ACCOUNT env for credentials.');
        } catch (parseErr) {
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
          console.log('[Auth] Using FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars for credentials.');
        }
      }

      if (credential) {
        admin.initializeApp({ credential });
      } else {
        // As a last resort, rely on default application credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS).
        admin.initializeApp();
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
    authReady = true;
    console.log('[Auth] Firebase Admin initialized.');
  } catch (e) {
    console.warn('[Auth] Failed to initialize firebase-admin. Set FIREBASE_AUTH_REQUIRED=false to bypass during local dev.', e);
  }
}

const app = express();
app.disable('x-powered-by');
// Parse JSON for non-multipart endpoints (e.g., webhooks)
app.use(express.json({ limit: '1mb' }));

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

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

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getWebhookTokenFromRequest(req) {
  return (
    normalizeToken(req.query?.token) ||
    normalizeToken(req.query?.secret) ||
    normalizeToken(req.get('x-orbita-webhook-token')) ||
    normalizeToken(req.get('x-webhook-token'))
  );
}

function isValidBunnyGuid(value) {
  return typeof value === 'string' && BUNNY_GUID_PATTERN.test(value.trim());
}

function normalizeWebhookPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const event = typeof payload.event === 'string' ? payload.event.trim() : '';
  const videoGuid = typeof payload.videoGuid === 'string' ? payload.videoGuid.trim() : '';
  const status = payload.status;

  return {
    event: event || 'unknown',
    videoGuid: videoGuid || null,
    status:
      typeof status === 'string' || typeof status === 'number'
        ? status
        : null,
    message:
      typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim().slice(0, 200)
        : null,
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.head('/health', (req, res) => {
  res.status(200).end();
});

// Optional: Bunny webhook receiver (set this URL in Bunny dashboard)
app.post('/bunny/webhook', webhookLimiter, async (req, res) => {
  try {
    if (BUNNY_WEBHOOK_TOKEN) {
      const requestToken = getWebhookTokenFromRequest(req);
      if (!requestToken || requestToken !== BUNNY_WEBHOOK_TOKEN) {
        console.warn('[Webhook] rejected unauthorized Bunny webhook request');
        return res.status(401).json({ error: 'Invalid webhook token' });
      }
    }

    const payload = normalizeWebhookPayload(req.body);
    if (!payload) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    if (payload.videoGuid && !isValidBunnyGuid(payload.videoGuid)) {
      return res.status(400).json({ error: 'Invalid videoGuid' });
    }

    console.log('[Webhook] Bunny event received', {
      event: payload.event,
      videoGuid: payload.videoGuid,
      status: payload.status,
      message: payload.message,
    });

    // Placeholder for future sync logic if video status needs to be persisted in Firestore.
    return res.status(202).json({ ok: true });
  } catch (e) {
    console.error('[Webhook] failed', e);
    return res.status(500).json({ error: String(e) });
  }
});

app.post('/bunny/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (FIREBASE_AUTH_REQUIRED) {
      if (!authReady) {
        return res.status(503).json({ error: 'Auth not initialized' });
      }
      try {
        await verifyIdToken(req.get('authorization'));
      } catch (authError) {
        const authMessage = String(authError || '');
        const explicitStatus = authError && typeof authError === 'object' && 'status' in authError
          ? Number(authError.status)
          : 0;
        const status = explicitStatus === 401 || explicitStatus === 403 ? explicitStatus : 401;
        console.warn('[Upload] auth failed', { status, authMessage });
        return res.status(status).json({ error: 'Invalid or expired auth token' });
      }
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file required' });
    }
    const titleRaw = typeof req.body.title === 'string' ? req.body.title : '';
    const normalizedTitle = (titleRaw || `Upload ${new Date().toISOString()}`).trim();
    const title = normalizedTitle.slice(0, 120);

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
    }, UPLOAD_TIMEOUT_MS);

    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => '');
      return res.status(uploadResp.status).send(txt || 'upload failed');
    }

    return res.json({
      guid,
      playbackUrl: `${CDN_HOST}/${guid}/playlist.m3u8`,
    });
  } catch (e) {
    const message = String(e || '');
    const explicitStatus = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 0;
    const inferredAuthFailure =
      /authorization|token|decode|auth|unauth/i.test(message) && explicitStatus !== 408;
    const status = explicitStatus || (inferredAuthFailure ? 401 : 500);
    console.error('[Upload] failure', e);
    return res.status(status || 500).json({ error: message });
  } finally {
    if (tempPath) {
      fs.unlink(tempPath, () => {});
    }
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Bunny upload API listening on :${PORT}`);
});
