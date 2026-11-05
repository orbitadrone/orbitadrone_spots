import {Dimensions, ViewToken} from 'react-native';

import {Spot} from '../../../src/services/firestoreService';
import {EventPostMeta, PostType, SocialPost} from '../../../src/services/socialService';
import {BUNNY_LIBRARY_ID} from '../../../src/constants/bunnyEnv';
import {
  buildBunnyEmbedUrl,
  extractBunnyVideoGuid,
  getVideoPreviewFromUrl,
} from '../../../src/utils/videoPlayback';

export type FeedTab = 'all' | 'spots';
export type ActiveLayer = 'feed' | 'map';

export type UnifiedPost = {
  id: string;
  type: Exclude<PostType, 'ad'>;
  createdAtMs: number;
  createdBy: string;
  text: string;
  images: string[];
  videoUrl?: string;
  thumbnailUrl?: string;
  spot?: Spot;
  eventId?: string;
  eventMeta?: EventPostMeta;
  sourcePost?: SocialPost;
  featured?: boolean;
};

export type FeedRow =
  | {kind: 'post'; post: UnifiedPost}
  | {kind: 'ad'; id: string};

const {height: screenHeight, width: screenWidth} = Dimensions.get('window');

export const SHEET_MIN_HEIGHT = 76;
export const SHEET_MID_HEIGHT = Math.round(screenHeight * 0.62);
export const SHEET_MAX_HEIGHT = Math.round(screenHeight * 0.9);
export const SHEET_PEEK_THRESHOLD = SHEET_MIN_HEIGHT + 6;
export const FEED_AD_FREQUENCY = 4;
export const FEED_PRIMARY_TIMEOUT_MS = 12000;
export const FEED_SECONDARY_TIMEOUT_MS = 10000;
export const FEED_AUTO_REFRESH_MIN_INTERVAL_MS = 15000;
export const FEED_AUTOPLAY_SWITCH_DELAY_MS = 180;
export const FEED_AUTOPLAY_CLEAR_DELAY_MS = 90;
export const FEED_POST_PREFETCH_WINDOW = 10;
export const FEED_POST_PREFETCH_DELAY_MS = 900;
export const FEED_VIDEO_WARMUP_TIMEOUT_MS = 2800;
export const FEED_VIDEO_WARMUP_RANGE_LAST_BYTE = 131071;
export const FEED_VIDEO_PROBE_AHEAD = 8;
export const FEED_VIDEO_MIN_PREFETCH_ROWS = 18;
export const FEED_VIDEO_BUFFER_CONFIG = {
  minBufferMs: 12000,
  maxBufferMs: 50000,
  bufferForPlaybackMs: 900,
  bufferForPlaybackAfterRebufferMs: 2200,
  backBufferDurationMs: 120000,
};
export const FEED_MEDIA_MIN_HEIGHT = 220;

const FEED_MEDIA_WIDTH = Math.max(1, screenWidth - 24);
const FEED_MEDIA_MAX_HEIGHT = Math.max(
  FEED_MEDIA_MIN_HEIGHT + 1,
  Math.round(screenHeight * 0.72),
);
const FEED_VERTICAL_VIDEO_COLLAPSED_MAX_HEIGHT = Math.max(
  FEED_MEDIA_MIN_HEIGHT + 1,
  Math.round(screenHeight * 0.42),
);
const FEED_VERTICAL_VIDEO_EXPANDED_MAX_HEIGHT = Math.max(
  FEED_MEDIA_MAX_HEIGHT + 1,
  Math.round(screenHeight * 0.9),
);
const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9;
const MIN_VIDEO_ASPECT_RATIO = 0.2;
const MAX_VIDEO_ASPECT_RATIO = 4;
const PORTRAIT_VIDEO_ASPECT_RATIO_THRESHOLD = 0.85;

export const getOrderedViewablePostIds = (viewableItems: Array<ViewToken>) =>
  [...viewableItems]
    .filter(viewable => viewable.isViewable)
    .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
    .map(viewable => viewable.item as FeedRow | undefined)
    .filter((row): row is Extract<FeedRow, {kind: 'post'}> => row?.kind === 'post')
    .map(row => row.post.id);

export const getOrderedViewableVideoPostIds = (viewableItems: Array<ViewToken>) =>
  [...viewableItems]
    .filter(viewable => viewable.isViewable)
    .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
    .map(viewable => viewable.item as FeedRow | undefined)
    .filter(
      (row): row is Extract<FeedRow, {kind: 'post'}> =>
        row?.kind === 'post' && Boolean(row.post.videoUrl),
    )
    .map(row => row.post.id);

export const getTargetVisibleRowsForPostWindow = (
  rows: FeedRow[],
  anchorPostId: string,
  postsAhead: number,
) => {
  if (!rows.length || postsAhead <= 0) {
    return rows.length;
  }
  const anchorRowIndex = rows.findIndex(
    row => row.kind === 'post' && row.post.id === anchorPostId,
  );
  if (anchorRowIndex < 0) {
    return rows.length;
  }

  let seenPosts = 0;
  let lastNeededRowIndex = anchorRowIndex;
  for (let index = anchorRowIndex + 1; index < rows.length; index += 1) {
    lastNeededRowIndex = index;
    if (rows[index]?.kind === 'post') {
      seenPosts += 1;
      if (seenPosts >= postsAhead) {
        break;
      }
    }
  }

  return Math.min(rows.length, Math.max(anchorRowIndex + 1, lastNeededRowIndex + 1));
};

export const pickWarmupVideoUrl = (urls: string[]) =>
  urls.find(url => /\/play(?:_\d+p)?\.mp4(?:\?|$)/i.test(url)) ??
  urls.find(url => /\.mp4(?:\?|$)/i.test(url)) ??
  urls.find(url => /playlist\.m3u8(?:\?|$)/i.test(url)) ??
  urls[0] ??
  '';

const parseDimensionValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
};

const normalizeVideoAspectRatio = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(MAX_VIDEO_ASPECT_RATIO, Math.max(MIN_VIDEO_ASPECT_RATIO, value));
};

export const getMeasuredVideoAspectRatio = (
  widthValue: unknown,
  heightValue: unknown,
) => {
  const width = parseDimensionValue(widthValue);
  const height = parseDimensionValue(heightValue);
  if (!width || !height) {
    return null;
  }
  return normalizeVideoAspectRatio(width / height);
};

export const getFeedVideoHeight = (aspectRatio?: number | null) => {
  const safeAspectRatio = normalizeVideoAspectRatio(aspectRatio) ?? DEFAULT_VIDEO_ASPECT_RATIO;
  const rawHeight = FEED_MEDIA_WIDTH / safeAspectRatio;
  const isPortraitVideo = safeAspectRatio < PORTRAIT_VIDEO_ASPECT_RATIO_THRESHOLD;
  const maxHeight = isPortraitVideo
    ? FEED_VERTICAL_VIDEO_COLLAPSED_MAX_HEIGHT
    : FEED_MEDIA_MAX_HEIGHT;
  return Math.max(1, Math.round(Math.min(maxHeight, rawHeight)));
};

export const getFeedVideoPlaybackHeight = (aspectRatio?: number | null) => {
  const safeAspectRatio = normalizeVideoAspectRatio(aspectRatio) ?? DEFAULT_VIDEO_ASPECT_RATIO;
  const rawHeight = FEED_MEDIA_WIDTH / safeAspectRatio;
  const isPortraitVideo = safeAspectRatio < PORTRAIT_VIDEO_ASPECT_RATIO_THRESHOLD;
  const maxHeight = isPortraitVideo
    ? FEED_VERTICAL_VIDEO_EXPANDED_MAX_HEIGHT
    : FEED_MEDIA_MAX_HEIGHT;
  return Math.max(1, Math.round(Math.min(maxHeight, rawHeight)));
};

export const getBunnyEmbedForVideoUrl = (videoUrl?: string) => {
  if (!videoUrl || !BUNNY_LIBRARY_ID) {
    return null;
  }
  const guid = extractBunnyVideoGuid(videoUrl);
  if (!guid) {
    return null;
  }
  const baseOptions = {loop: true};
  const embedUrl = buildBunnyEmbedUrl(BUNNY_LIBRARY_ID, guid, {
    autoplay: false,
    ...baseOptions,
  });
  const autoplayEmbedUrl = buildBunnyEmbedUrl(BUNNY_LIBRARY_ID, guid, {
    autoplay: true,
    muted: true,
    ...baseOptions,
  });
  if (!embedUrl || !autoplayEmbedUrl) {
    return null;
  }
  return {
    guid,
    embedUrl,
    autoplayEmbedUrl,
  };
};

export const buildInlineBunnyIframeHtml = (embedUrl: string) => {
  const safeEmbedUrl = embedUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #000;
        overflow: hidden;
      }
      #player {
        width: 100%;
        height: 100%;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe
      id="player"
      src="${safeEmbedUrl}"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
      frameborder="0"
    ></iframe>
    <script>
      (function () {
        var send = function (type, payload) {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: type, payload: payload || null })
            );
          }
        };
        var iframe = document.getElementById('player');
        send('html_loaded', { src: iframe ? iframe.src : null });
        if (iframe) {
          iframe.addEventListener('load', function () {
            send('iframe_loaded', { src: iframe.src });
          });
        }
        window.addEventListener('error', function (event) {
          send('html_error', { message: String(event && event.message ? event.message : 'unknown') });
        });
      })();
    </script>
  </body>
</html>`;
};

export const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timeout: ${label}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const getTimestampMillis = (value: unknown): number => {
  if (!value) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate().getTime();
    }
    if (typeof timestamp.seconds === 'number') {
      return timestamp.seconds * 1000;
    }
  }
  return 0;
};

export const getSpotCoordinates = (spot: Spot) => {
  const coordinates: any = (spot as any).coordinates;
  const latitude =
    coordinates?.latitude ??
    coordinates?._latitude ??
    (spot as any).latitude ??
    (spot as any).lat;
  const longitude =
    coordinates?.longitude ??
    coordinates?._longitude ??
    (spot as any).longitude ??
    (spot as any).lng ??
    (spot as any).lon;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }

  return {latitude, longitude};
};

export const getVideoPreviewImage = (post: UnifiedPost): string | null => {
  const thumbnail = post.thumbnailUrl?.trim();
  if (thumbnail) {
    return thumbnail;
  }
  if (post.images.length > 0 && post.images[0]) {
    return post.images[0];
  }
  const videoUrl = post.videoUrl?.trim();
  if (!videoUrl) {
    return null;
  }
  return getVideoPreviewFromUrl(videoUrl);
};

export const calculateDistanceKm = (
  from: {latitude: number; longitude: number},
  to: {latitude: number; longitude: number},
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};
