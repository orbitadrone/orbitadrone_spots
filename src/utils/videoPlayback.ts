const BUNNY_HOST_PATTERN = /(?:^|\/\/)(?:[^/]+\.)?b-cdn\.net|video\.bunnycdn\.com/i;
const BUNNY_GUID_PATTERN = /\/([0-9a-fA-F-]{36})(?:\/[^/?]*)?(?:\?.*)?$/;
const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const BUNNY_PLAYBACK_FILE_PATTERN = /\/(?:playlist\.m3u8|play(?:_\d+p)?\.mp4)(?:\?.*)?$/i;
const BUNNY_EMBED_ORIGIN = 'https://iframe.mediadelivery.net';

const PLAYLIST_PATTERN = /^(.*)\/playlist\.m3u8(\?.*)?$/i;
const PLAYBACK_THUMBNAIL_PATTERN = /^(.*)\/(?:playlist\.m3u8|play(?:_\d+p)?\.mp4)(\?.*)?$/i;

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const stripQueryString = (value: string) => value.replace(/\?.*$/, '');

const hasBunnyPlaybackPath = (value: string) => {
  const withoutQuery = stripQueryString(value);
  return BUNNY_PLAYBACK_FILE_PATTERN.test(withoutQuery);
};

const getLastGuidMatch = (value: string) => {
  const matches = value.match(UUID_PATTERN);
  if (!matches?.length) {
    return null;
  }
  return matches[matches.length - 1];
};

export const isBunnyVideoUrl = (rawUrl: string) => {
  const normalized = normalizeRemoteVideoUrl(rawUrl);
  return Boolean(normalized) && (BUNNY_HOST_PATTERN.test(normalized) || hasBunnyPlaybackPath(normalized));
};

export const extractBunnyVideoGuid = (rawUrl: string) => {
  const normalized = normalizeRemoteVideoUrl(rawUrl);
  if (!normalized) {
    return null;
  }
  const looksLikeBunny = BUNNY_HOST_PATTERN.test(normalized) || hasBunnyPlaybackPath(normalized);
  if (!looksLikeBunny) {
    return null;
  }

  const directMatch = normalized.match(BUNNY_GUID_PATTERN);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  const pathGuid = getLastGuidMatch(stripQueryString(normalized));
  if (pathGuid) {
    return pathGuid;
  }

  const queryGuidMatch = normalized.match(/[?&](?:guid|videoId)=([^&]+)/i);
  if (queryGuidMatch?.[1]) {
    const decodedQueryGuid = decodeURIComponent(queryGuidMatch[1]);
    const queryGuid = getLastGuidMatch(decodedQueryGuid);
    if (queryGuid) {
      return queryGuid;
    }
  }

  return null;
};

export const buildBunnyEmbedUrl = (
  libraryId: string,
  guid: string,
  options?: {autoplay?: boolean; muted?: boolean; loop?: boolean},
) => {
  const cleanLibraryId = libraryId.trim();
  const cleanGuid = guid.trim();
  if (!cleanLibraryId || !cleanGuid) {
    return '';
  }
  const autoplay = options?.autoplay ? 'true' : 'false';
  const muted = options?.muted ? 'true' : 'false';
  const loop = options?.loop ? 'true' : 'false';
  return `https://iframe.mediadelivery.net/embed/${cleanLibraryId}/${cleanGuid}?autoplay=${autoplay}&muted=${muted}&loop=${loop}`;
};

export const isTrustedBunnyEmbedRequestUrl = (rawUrl: string) => {
  const normalized = rawUrl?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized === 'about:blank' ||
    normalized === BUNNY_EMBED_ORIGIN ||
    normalized === `${BUNNY_EMBED_ORIGIN}/` ||
    normalized.startsWith(`${BUNNY_EMBED_ORIGIN}/`)
  );
};

export const normalizeRemoteVideoUrl = (rawUrl: string) => {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return '';
  }

  if (isAbsoluteHttpUrl(trimmed) || trimmed.startsWith('file://') || trimmed.startsWith('content://')) {
    return trimmed;
  }

  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
};

const buildPlaylistDerivedUrls = (playlistUrl: string, keepQuery = true) => {
  const match = playlistUrl.match(PLAYLIST_PATTERN);
  if (!match) {
    return [];
  }

  const base = match[1];
  const query = keepQuery ? match[2] ?? '' : '';

  return [
    `${base}/playlist.m3u8${query}`,
    `${base}/play.mp4${query}`,
    `${base}/play_720p.mp4${query}`,
    `${base}/play_480p.mp4${query}`,
    `${base}/play_360p.mp4${query}`,
  ];
};

export const getVideoPreviewFromUrl = (rawUrl: string) => {
  const candidates = getVideoPreviewCandidatesFromUrl(rawUrl);
  return candidates[0] ?? null;
};

export const getVideoPreviewCandidatesFromUrl = (rawUrl: string) => {
  const normalized = normalizeRemoteVideoUrl(rawUrl);
  if (!normalized) {
    return [];
  }

  const playbackMatch = normalized.match(PLAYBACK_THUMBNAIL_PATTERN);
  if (playbackMatch) {
    const base = playbackMatch[1];
    const query = playbackMatch[2] ?? '';
    return unique([
      `${base}/thumbnail.jpg${query}`,
      `${base}/preview.webp${query}`,
    ]);
  }

  const guid = extractBunnyVideoGuid(normalized);
  if (!guid) {
    return [];
  }

  const originMatch = normalized.match(/^(https?:\/\/[^/]+)/i);
  if (!originMatch?.[1]) {
    return [];
  }
  const queryMatch = normalized.match(/(\?.*)$/);
  const query = queryMatch?.[1] ?? '';
  return unique([
    `${originMatch[1]}/${guid}/thumbnail.jpg${query}`,
    `${originMatch[1]}/${guid}/preview.webp${query}`,
  ]);
};

export const buildVideoSourceCandidates = (rawUrl: string) => {
  const normalized = normalizeRemoteVideoUrl(rawUrl);
  if (!normalized) {
    return [];
  }

  const isBunnyHost = BUNNY_HOST_PATTERN.test(normalized) || hasBunnyPlaybackPath(normalized);
  const playlistCandidates = isBunnyHost
    ? unique([
        ...buildPlaylistDerivedUrls(normalized, true),
        ...buildPlaylistDerivedUrls(stripQueryString(normalized), false),
      ])
    : buildPlaylistDerivedUrls(normalized, true);
  if (playlistCandidates.length) {
    return unique(playlistCandidates);
  }

  const guidMatch = normalized.match(BUNNY_GUID_PATTERN);

  if (isBunnyHost && guidMatch) {
    const originMatch = normalized.match(/^(https?:\/\/[^/]+)/i);
    if (originMatch) {
      const guid = guidMatch[1];
      const base = `${originMatch[1]}/${guid}`;
      return unique([
        `${base}/playlist.m3u8`,
        `${base}/play.mp4`,
        `${base}/play_720p.mp4`,
        `${base}/play_480p.mp4`,
        `${base}/play_360p.mp4`,
        stripQueryString(normalized),
        normalized,
      ]);
    }
  }

  if (isBunnyHost) {
    return unique([stripQueryString(normalized), normalized]);
  }

  return [normalized];
};
