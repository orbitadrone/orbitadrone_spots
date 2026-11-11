import type {Region} from 'react-native-maps';

import type {
  PilotMarkerMapEntry,
  Spot,
  UserProfile,
} from '../../../src/services/firestoreService';

export const MARKER_VISIBILITY_SHOW_THRESHOLD = 2.5;
export const MARKER_VISIBILITY_HIDE_THRESHOLD = 2.5;

export type SearchResult =
  | {type: 'pilot'; pilot: PilotMarkerMapEntry}
  | {type: 'spot'; spot: Spot};

export type ParsedMapSearch = {
  hasSearch: boolean;
  plainQuery: string;
  tags: string[];
  terms: string[];
};

export const areRegionsSimilar = (
  a: Region | null,
  b: Region,
  tolerance = 0.00001,
) => {
  if (!a) {
    return false;
  }

  return (
    Math.abs(a.latitude - b.latitude) <= tolerance &&
    Math.abs(a.longitude - b.longitude) <= tolerance &&
    Math.abs(a.latitudeDelta - b.latitudeDelta) <= tolerance &&
    Math.abs(a.longitudeDelta - b.longitudeDelta) <= tolerance
  );
};

export const arePilotMarkerListsEqual = (
  a: PilotMarkerMapEntry[],
  b: PilotMarkerMapEntry[],
) => {
  if (a.length !== b.length) {
    return false;
  }
  const serialize = (list: PilotMarkerMapEntry[]) =>
    list
      .map(marker => `${marker.id}:${marker.latitude}:${marker.longitude}:${marker.photoUrl ?? ''}`)
      .sort()
      .join('|');
  return serialize(a) === serialize(b);
};

export const isValidPilotMarker = (marker?: {latitude?: number; longitude?: number}) =>
  Boolean(
    marker &&
      typeof marker.latitude === 'number' &&
      typeof marker.longitude === 'number',
  );

export const buildPilotMarkerData = (pilotProfile: UserProfile | null) => {
  const pilotMarker = pilotProfile?.pilotMarker;
  return isValidPilotMarker(pilotMarker) && pilotProfile?.showPilotMarker !== false
    ? {
        latitude: pilotMarker!.latitude,
        longitude: pilotMarker!.longitude,
        photoUrl: pilotProfile?.profilePictureUrl,
      }
    : null;
};

export const buildPilotMarkersForMap = ({
  pilotMarkerData,
  pilotMarkers,
  userId,
}: {
  pilotMarkerData: {latitude: number; longitude: number; photoUrl?: string | null} | null;
  pilotMarkers: PilotMarkerMapEntry[];
  userId?: string;
}) => {
  if (!pilotMarkerData || !userId) {
    return pilotMarkers;
  }
  const existingIndex = pilotMarkers.findIndex(marker => marker.id === userId);
  if (existingIndex !== -1) {
    const updated = [...pilotMarkers];
    updated[existingIndex] = {
      ...updated[existingIndex],
      latitude: pilotMarkerData.latitude,
      longitude: pilotMarkerData.longitude,
      photoUrl: pilotMarkerData.photoUrl ?? updated[existingIndex].photoUrl ?? null,
    };
    return updated;
  }
  return [
    ...pilotMarkers,
    {
      id: userId,
      latitude: pilotMarkerData.latitude,
      longitude: pilotMarkerData.longitude,
      photoUrl: pilotMarkerData.photoUrl ?? null,
    },
  ];
};

export const normalizeMapTag = (value: string) => {
  const cleaned = value.replace(/^#+/, '').trim().toLowerCase();
  return cleaned.replace(/\s+/g, '');
};

export const parseMapSearch = (searchQuery: string): ParsedMapSearch => {
  const tokens = searchQuery
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  const tags = tokens
    .filter(token => token.startsWith('#'))
    .map(token => normalizeMapTag(token))
    .filter(Boolean);
  const terms = tokens
    .filter(token => !token.startsWith('#'))
    .map(token => token.toLowerCase());

  return {
    tags,
    terms,
    hasSearch: tokens.length > 0,
    plainQuery: terms.join(' ').trim(),
  };
};

export const buildFilteredSpots = ({
  parsedSearch,
  selectedStyles,
  spots,
}: {
  parsedSearch: ParsedMapSearch;
  selectedStyles: string[];
  spots: Spot[];
}) => {
  let spotsResult = [...spots];
  const {hasSearch, terms, tags} = parsedSearch;

  if (hasSearch) {
    if (terms.length > 0) {
      spotsResult = spotsResult.filter(spot => {
        const haystack =
          `${spot.name} ${spot.address ?? ''} ${spot.description ?? ''}`.toLowerCase();
        return terms.every(term => haystack.includes(term));
      });
    }
    if (tags.length > 0) {
      spotsResult = spotsResult.filter(spot => {
        const spotTags = (spot.tags ?? []).map(value => normalizeMapTag(value));
        return tags.every(tag => spotTags.includes(tag));
      });
    }
  }

  if (selectedStyles.length > 0) {
    spotsResult = spotsResult.filter(
      spot =>
        spot.flightStyles && spot.flightStyles.some(style => selectedStyles.includes(style)),
    );
  }

  return hasSearch || selectedStyles.length > 0 ? spotsResult : spots;
};

export const buildFilteredPilots = ({
  parsedSearch,
  pilotMarkers,
}: {
  parsedSearch: ParsedMapSearch;
  pilotMarkers: PilotMarkerMapEntry[];
}) => {
  if (!parsedSearch.plainQuery) {
    return [];
  }

  const lowercasedQuery = parsedSearch.plainQuery.toLowerCase();
  return pilotMarkers.filter(marker => {
    const nameMatch = marker.displayName?.toLowerCase().includes(lowercasedQuery);
    const regionMatch = marker.cityRegion?.toLowerCase().includes(lowercasedQuery);
    return Boolean(nameMatch || regionMatch);
  });
};

export const buildSearchResults = (
  pilots: PilotMarkerMapEntry[],
  spots: Spot[],
): SearchResult[] => [
  ...pilots.map(pilot => ({type: 'pilot' as const, pilot})),
  ...spots.map(spot => ({type: 'spot' as const, spot})),
];

export const getSpotRegion = (spot: Spot): Region | null => {
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

  return {
    latitude,
    longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };
};
