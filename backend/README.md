# Bunny Upload Backend

Minimal Express service that accepts a multipart `file` and optional `title`, creates a Bunny video entry, uploads the file, and returns `{ guid, playbackUrl }`.

## Setup

- Requirements: Node.js 18+
- Copy env and install deps:

```
cd backend
cp .env.example .env
npm i
```

- Edit `.env` with your Bunny values and Firebase settings.
- Start: `npm start`

### Docker (local)

```
docker build -t orbitadrone-bunny-backend .
docker run --rm -p 3000:3000 --env-file .env orbitadrone-bunny-backend
```

## Env Vars

- `PORT` (default 3000)
- `BUNNY_LIBRARY_ID`
- `BUNNY_STREAM_API_KEY`
- `BUNNY_CDN_HOST` (e.g., `https://<library>.b-cdn.net`)
- `FIREBASE_AUTH_REQUIRED` (default `true`). If true, clients must send `Authorization: Bearer <Firebase ID token>`.
- `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON for `firebase-admin`, or use other ADC methods).

## Test

```
curl -F "file=@/path/video.mp4" -F "title=Prueba" http://localhost:3000/bunny/upload
```

Response:

```
{ "guid": "...", "playbackUrl": "https://.../playlist.m3u8" }
```

## Mobile App

Set in `.env` of the app:

```
BUNNY_UPLOAD_ENDPOINT="http://<server-host>:3000/bunny/upload"
BUNNY_CLIENT_UPLOAD_ENABLED="false"
```

## Security Notes

- Keep Bunny keys only on the server.
- Require Firebase ID token (recommended). Grant access based on your rules.
- Add rate limiting, file type checks (`video/*`), and HTTPS in production.

## Deploy to Cloud Run (optional)

Prereqs: `gcloud` CLI configured, a GCP project selected, Artifact Registry or Container Registry enabled.

```
gcloud builds submit --tag gcr.io/<PROJECT_ID>/bunny-backend ./
gcloud run deploy bunny-backend \
  --image gcr.io/<PROJECT_ID>/bunny-backend \
  --platform managed \
  --region <REGION> \
  --allow-unauthenticated

# Set env vars in Cloud Run console or via CLI
gcloud run services update bunny-backend \
  --region <REGION> \
  --update-env-vars BUNNY_LIBRARY_ID=...,BUNNY_STREAM_API_KEY=...,BUNNY_CDN_HOST=...,FIREBASE_AUTH_REQUIRED=true
```

Note: Keep `FIREBASE_AUTH_REQUIRED=true`. The mobile app will send `Authorization: Bearer <ID token>` automatically.
