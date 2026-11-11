import {
  FirebaseFirestoreTypes,
  GeoPoint,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';

import {auth} from '../firebaseConfig';
import {
  retryAsync,
  isRetriableFirestoreError,
  isRetriableNetworkError,
} from '../utils/retry';
import {invalidateSocialPostsQueryCache} from './contentQueryCache';
import {requireAuthenticatedUser} from './authSession';
import logger from '../utils/logger';

export type EventParticipantStatus =
  | 'host'
  | 'invited'
  | 'going'
  | 'requested'
  | 'declined';

export type EventPublicJoinMode = 'approval_required' | 'open';

export const DEFAULT_EVENT_PUBLIC_JOIN_MODE: EventPublicJoinMode = 'approval_required';

export type DroneEventLink = {
  label: string;
  url: string;
};

export type DroneEventMedia = {
  images?: string[];
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
};

export interface DroneEvent {
  id?: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  createdAtMs?: number;
  startsAt: FirebaseFirestoreTypes.Timestamp;
  startsAtMs: number;
  cleanupAfterMs: number;
  isPublic: boolean;
  publicJoinMode?: EventPublicJoinMode;
  coordinates?: FirebaseFirestoreTypes.GeoPoint | null;
  locationLabel?: string | null;
  locationAddress?: string | null;
  media?: DroneEventMedia;
  checklist?: string[];
  links?: DroneEventLink[];
  invitedUserIds?: string[];
  mirrorPostId?: string;
}

export interface EventParticipant {
  id?: string;
  userId: string;
  status: EventParticipantStatus;
  invitedBy?: string | null;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  respondedAt?: FirebaseFirestoreTypes.Timestamp | null;
}

export type EventMarkerEntry = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  locationLabel?: string | null;
  startsAtMs: number;
  coverImageUrl?: string | null;
};

export type JoinPublicEventResult = {
  participantStatus: Extract<EventParticipantStatus, 'requested' | 'invited' | 'going'>;
  publicJoinMode: EventPublicJoinMode;
  alreadyParticipant: boolean;
};

const db = getFirestore();
const EVENTS_COLLECTION = 'events';
const EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

export const resolveEventPublicJoinMode = (
  event?: Pick<DroneEvent, 'publicJoinMode'> | null,
): EventPublicJoinMode =>
  event?.publicJoinMode === 'open' ? 'open' : DEFAULT_EVENT_PUBLIC_JOIN_MODE;

const shouldRetryFirestore = (error: unknown) =>
  isRetriableFirestoreError(error) || isRetriableNetworkError(error);

const runResilientFirestoreRead = async <T>(
  label: string,
  operation: () => Promise<T>,
) =>
  retryAsync(operation, {
    attempts: 3,
    shouldRetry: shouldRetryFirestore,
    onRetry: ({attempt, delayMs, error}) => {
      logger.warn(
        `[Events] ${label} attempt ${attempt} failed. Retrying in ${delayMs}ms`,
        error,
      );
    },
  });

const wrapFirestoreWrite = async <T>(
  label: string,
  operation: () => Promise<T>,
) => {
  try {
    return await operation();
  } catch (error) {
    logger.error(`[Events] ${label} failed`, error);
    throw error;
  }
};

const ensureSignedInUser = async (context: string) =>
  auth.currentUser ?? requireAuthenticatedUser(context);

const sanitizeTrimmedText = (value?: string | null, maxLength = 0) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }
  if (maxLength > 0) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
};

const normalizeStringList = (items: Array<string | null | undefined>, maxItems = 12) =>
  items
    .map(item => sanitizeTrimmedText(item))
    .filter(Boolean)
    .slice(0, maxItems);

const normalizeLinks = (links: Array<Partial<DroneEventLink>> = []) =>
  links
    .map(link => {
      const label = sanitizeTrimmedText(link.label, 80);
      const url = sanitizeTrimmedText(link.url, 300);
      if (!url) {
        return null;
      }
      return {
        label: label || url,
        url,
      } as DroneEventLink;
    })
    .filter((value): value is DroneEventLink => Boolean(value))
    .slice(0, 8);

const getTimestampMillis = (value: unknown): number => {
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

export const getEventMirrorPostDocId = (eventId: string) => `event_${eventId}`;

const buildEventMirrorPostData = ({
  eventId,
  createdBy,
  createdAtMs,
  description,
  images,
  isPublic,
  latitude,
  longitude,
  locationAddress,
  locationLabel,
  startsAtMs,
  thumbnailUrl,
  title,
  videoUrl,
  publicJoinMode,
}: {
  eventId: string;
  createdBy: string;
  createdAtMs: number;
  description: string;
  images: string[];
  isPublic: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationAddress?: string | null;
  locationLabel?: string | null;
  startsAtMs: number;
  thumbnailUrl?: string | null;
  title: string;
  videoUrl?: string | null;
  publicJoinMode: EventPublicJoinMode;
}) => ({
  type: 'event',
  eventId,
  createdBy,
  text: description,
  createdAtMs,
  createdAt: serverTimestamp(),
  media: {
    images,
    videoUrl: videoUrl ?? null,
    thumbnailUrl: thumbnailUrl ?? images[0] ?? null,
  },
  eventMeta: {
    title,
    startsAtMs,
    locationLabel: locationLabel ?? null,
    locationAddress: locationAddress ?? null,
    latitude: typeof latitude === 'number' ? latitude : null,
    longitude: typeof longitude === 'number' ? longitude : null,
    isPublic,
    publicJoinMode,
    coverImageUrl: images[0] ?? thumbnailUrl ?? null,
  },
  isHidden: false,
  featured: false,
});

export const createEvent = async ({
  title,
  description,
  startsAt,
  isPublic,
  publicJoinMode = DEFAULT_EVENT_PUBLIC_JOIN_MODE,
  latitude,
  longitude,
  locationLabel,
  locationAddress,
  images = [],
  videoUrl,
  thumbnailUrl,
  checklist = [],
  links = [],
  invitedUserIds = [],
}: {
  title: string;
  description: string;
  startsAt: Date;
  isPublic: boolean;
  publicJoinMode?: EventPublicJoinMode;
  latitude?: number | null;
  longitude?: number | null;
  locationLabel?: string | null;
  locationAddress?: string | null;
  images?: string[];
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  checklist?: string[];
  links?: Array<Partial<DroneEventLink>>;
  invitedUserIds?: string[];
}) => {
  const currentUser = await ensureSignedInUser('createEvent');
  const cleanTitle = sanitizeTrimmedText(title, 120);
  const cleanDescription = sanitizeTrimmedText(description, 2200);
  const cleanChecklist = normalizeStringList(checklist, 20);
  const cleanLinks = normalizeLinks(links);
  const cleanImages = normalizeStringList(images, 6);
  const cleanInvitedUserIds = Array.from(
    new Set(
      invitedUserIds
        .map(value => sanitizeTrimmedText(value))
        .filter(value => Boolean(value) && value !== currentUser.uid),
    ),
  ).slice(0, 30);

  if (!cleanTitle) {
    throw new Error('event_title_required');
  }
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new Error('event_start_date_invalid');
  }

  const startsAtMs = startsAt.getTime();
  const cleanupAfterMs = startsAtMs + EVENT_RETENTION_MS;
  const createdAtMs = Date.now();
  const resolvedPublicJoinMode =
    publicJoinMode === 'open' ? 'open' : DEFAULT_EVENT_PUBLIC_JOIN_MODE;
  const eventsCollectionRef = collection(db, EVENTS_COLLECTION);
  const eventRef = doc(eventsCollectionRef);
  const mirrorPostId = getEventMirrorPostDocId(eventRef.id);
  const coordinates =
    typeof latitude === 'number' && typeof longitude === 'number'
      ? new GeoPoint(latitude, longitude)
      : null;

  const eventPayload = {
    title: cleanTitle,
    description: cleanDescription,
    createdBy: currentUser.uid,
    createdAt: serverTimestamp(),
    createdAtMs,
    startsAt,
    startsAtMs,
    cleanupAfterMs,
    isPublic,
    publicJoinMode: resolvedPublicJoinMode,
    coordinates,
    locationLabel: sanitizeTrimmedText(locationLabel, 120) || null,
    locationAddress: sanitizeTrimmedText(locationAddress, 220) || null,
    media: {
      images: cleanImages,
      videoUrl: videoUrl ?? null,
      thumbnailUrl: thumbnailUrl ?? cleanImages[0] ?? null,
    },
    checklist: cleanChecklist,
    links: cleanLinks,
    invitedUserIds: cleanInvitedUserIds,
    mirrorPostId,
  };

  await wrapFirestoreWrite('createEvent.eventDoc', () => setDoc(eventRef, eventPayload));

  const participantWrites: Array<Promise<unknown>> = [
    setDoc(doc(db, EVENTS_COLLECTION, eventRef.id, 'participants', currentUser.uid), {
      userId: currentUser.uid,
      status: 'host',
      invitedBy: currentUser.uid,
      createdAt: serverTimestamp(),
      respondedAt: serverTimestamp(),
    }),
    setDoc(
      doc(db, 'posts', mirrorPostId),
      buildEventMirrorPostData({
        eventId: eventRef.id,
        createdBy: currentUser.uid,
        createdAtMs,
        description: cleanDescription,
        images: cleanImages,
        isPublic,
        latitude: typeof latitude === 'number' ? latitude : null,
        longitude: typeof longitude === 'number' ? longitude : null,
        locationAddress: eventPayload.locationAddress,
        locationLabel: eventPayload.locationLabel,
        startsAtMs,
        thumbnailUrl: eventPayload.media.thumbnailUrl,
        title: cleanTitle,
        videoUrl: videoUrl ?? null,
        publicJoinMode: resolvedPublicJoinMode,
      }),
    ),
  ];

  cleanInvitedUserIds.forEach(invitedUserId => {
    participantWrites.push(
      setDoc(doc(db, EVENTS_COLLECTION, eventRef.id, 'participants', invitedUserId), {
        userId: invitedUserId,
        status: 'invited',
        invitedBy: currentUser.uid,
        createdAt: serverTimestamp(),
        respondedAt: null,
      }),
    );
  });

  await wrapFirestoreWrite('createEvent.relatedDocs', () => Promise.all(participantWrites));
  invalidateSocialPostsQueryCache();
  return {eventId: eventRef.id, mirrorPostId};
};

export const getEvent = async (eventId: string): Promise<DroneEvent | null> => {
  const eventRef = doc(db, EVENTS_COLLECTION, eventId);
  const snapshot = await runResilientFirestoreRead('getEvent', () => getDoc(eventRef));
  if (!snapshot.exists()) {
    return null;
  }
  return {id: snapshot.id, ...snapshot.data()} as DroneEvent;
};

export const getPublicEvents = async (): Promise<DroneEvent[]> => {
  const now = Date.now();
  const eventsQuery = query(
    collection(db, EVENTS_COLLECTION),
    where('isPublic', '==', true),
  );
  const snapshot = await runResilientFirestoreRead('getPublicEvents', () =>
    getDocs(eventsQuery),
  );
  return snapshot.docs
    .map(docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as DroneEvent))
    .filter(event => (event.cleanupAfterMs ?? 0) > now)
    .sort((a, b) => (a.startsAtMs ?? 0) - (b.startsAtMs ?? 0));
};

export const getEventsByUser = async (userId: string): Promise<DroneEvent[]> => {
  const eventsQuery = query(
    collection(db, EVENTS_COLLECTION),
    where('createdBy', '==', userId),
  );
  const snapshot = await runResilientFirestoreRead('getEventsByUser', () =>
    getDocs(eventsQuery),
  );
  return snapshot.docs
    .map(docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as DroneEvent))
    .sort((a, b) => (b.startsAtMs ?? 0) - (a.startsAtMs ?? 0));
};

export const getPublicEventMarkers = async (): Promise<EventMarkerEntry[]> => {
  const events = await getPublicEvents();
  return events
    .map(event => {
      const coordinates = event.coordinates as
        | FirebaseFirestoreTypes.GeoPoint
        | undefined
        | null;
      if (!coordinates) {
        return null;
      }
      return {
        id: event.id!,
        title: event.title,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        locationLabel: event.locationLabel ?? event.locationAddress ?? null,
        startsAtMs: event.startsAtMs,
        coverImageUrl: event.media?.images?.[0] ?? event.media?.thumbnailUrl ?? null,
      } as EventMarkerEntry;
    })
    .filter((entry): entry is EventMarkerEntry => Boolean(entry));
};

export const getEventParticipants = async (
  eventId: string,
): Promise<EventParticipant[]> => {
  const participantsQuery = query(
    collection(db, EVENTS_COLLECTION, eventId, 'participants'),
    orderBy('createdAt', 'asc'),
  );
  const snapshot = await runResilientFirestoreRead('getEventParticipants', () =>
    getDocs(participantsQuery),
  );
  return snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as EventParticipant),
  );
};

export const getEventParticipant = async (
  eventId: string,
  userId: string,
): Promise<EventParticipant | null> => {
  const participantRef = doc(db, EVENTS_COLLECTION, eventId, 'participants', userId);
  const snapshot = await runResilientFirestoreRead('getEventParticipant', () =>
    getDoc(participantRef),
  );
  if (!snapshot.exists()) {
    return null;
  }
  return {id: snapshot.id, ...snapshot.data()} as EventParticipant;
};

export const joinPublicEvent = async (
  eventId: string,
): Promise<JoinPublicEventResult> => {
  const currentUser = await ensureSignedInUser('requestJoinEvent');
  const [event, existingParticipant] = await Promise.all([
    getEvent(eventId),
    getEventParticipant(eventId, currentUser.uid),
  ]);

  if (!event) {
    throw new Error('event_not_found');
  }
  if (!event.isPublic) {
    throw new Error('event_private_access_only');
  }

  const publicJoinMode = resolveEventPublicJoinMode(event);
  const alreadyParticipant = Boolean(existingParticipant);
  const participantRef = doc(db, EVENTS_COLLECTION, eventId, 'participants', currentUser.uid);

  if (existingParticipant?.status === 'declined') {
    throw new Error('event_participation_managed_by_host');
  }

  if (publicJoinMode === 'open') {
    if (existingParticipant?.status === 'going') {
      return {
        participantStatus: 'going',
        publicJoinMode,
        alreadyParticipant,
      };
    }

    if (existingParticipant?.status === 'invited') {
      await wrapFirestoreWrite('joinPublicEvent.promoteInvitedToGoing', () =>
        setDoc(
          participantRef,
          {
            userId: currentUser.uid,
            status: 'going',
            invitedBy: existingParticipant.invitedBy ?? event.createdBy,
            respondedAt: serverTimestamp(),
          },
          {merge: true},
        ),
      );
      return {
        participantStatus: 'going',
        publicJoinMode,
        alreadyParticipant,
      };
    }

    if (existingParticipant?.status === 'requested') {
      await wrapFirestoreWrite('joinPublicEvent.promoteRequestedToGoing', () =>
        setDoc(
          participantRef,
          {
            userId: currentUser.uid,
            status: 'going',
            invitedBy: event.createdBy,
            respondedAt: serverTimestamp(),
          },
          {merge: true},
        ),
      );
      return {
        participantStatus: 'going',
        publicJoinMode,
        alreadyParticipant,
      };
    }

    await wrapFirestoreWrite('joinPublicEvent.createGoing', () =>
      setDoc(
        participantRef,
        {
          userId: currentUser.uid,
          status: 'going',
          invitedBy: event.createdBy,
          createdAt: serverTimestamp(),
          respondedAt: serverTimestamp(),
        },
        {merge: true},
      ),
    );
    return {
      participantStatus: 'going',
      publicJoinMode,
      alreadyParticipant,
    };
  }

  if (existingParticipant?.status === 'requested') {
    return {
      participantStatus: 'requested',
      publicJoinMode,
      alreadyParticipant,
    };
  }

  if (existingParticipant?.status === 'invited') {
    return {
      participantStatus: 'invited',
      publicJoinMode,
      alreadyParticipant,
    };
  }

  if (existingParticipant?.status === 'going') {
    return {
      participantStatus: 'going',
      publicJoinMode,
      alreadyParticipant,
    };
  }

  await wrapFirestoreWrite('joinPublicEvent.createRequested', () =>
    setDoc(
      participantRef,
      {
        userId: currentUser.uid,
        status: 'requested',
        invitedBy: null,
        createdAt: serverTimestamp(),
        respondedAt: null,
      },
      {merge: true},
    ),
  );
  return {
    participantStatus: 'requested',
    publicJoinMode,
    alreadyParticipant,
  };
};

export const respondToEventInvitation = async ({
  eventId,
  status,
}: {
  eventId: string;
  status: Extract<EventParticipantStatus, 'going' | 'declined'>;
}) => {
  const currentUser = await ensureSignedInUser('respondToEventInvitation');
  const participantRef = doc(db, EVENTS_COLLECTION, eventId, 'participants', currentUser.uid);
  return wrapFirestoreWrite('respondToEventInvitation', () =>
    setDoc(
      participantRef,
      {
        userId: currentUser.uid,
        status,
        respondedAt: serverTimestamp(),
      },
      {merge: true},
    ),
  );
};

export const setEventParticipantStatus = async ({
  eventId,
  participantUserId,
  status,
}: {
  eventId: string;
  participantUserId: string;
  status: Extract<EventParticipantStatus, 'invited' | 'declined'>;
}) => {
  const currentUser = await ensureSignedInUser('setEventParticipantStatus');
  const participantRef = doc(db, EVENTS_COLLECTION, eventId, 'participants', participantUserId);
  const nextPayload: Record<string, unknown> = {
    status,
    respondedAt: status === 'invited' ? null : serverTimestamp(),
  };
  if (status === 'invited') {
    nextPayload.invitedBy = currentUser.uid;
  }
  return wrapFirestoreWrite('setEventParticipantStatus', () =>
    updateDoc(participantRef, nextPayload),
  );
};

export const deleteEvent = async (eventId: string) => {
  await ensureSignedInUser('deleteEvent');
  const eventRef = doc(db, EVENTS_COLLECTION, eventId);
  const fallbackMirrorPostId = getEventMirrorPostDocId(eventId);
  return wrapFirestoreWrite('deleteEvent', async () => {
    const eventSnapshot = await getDoc(eventRef);
    const mirrorPostIds = new Set<string>([fallbackMirrorPostId]);

    if (eventSnapshot.exists()) {
      const eventData = eventSnapshot.data() as Partial<DroneEvent>;
      const storedMirrorPostId = sanitizeTrimmedText(eventData.mirrorPostId);
      if (storedMirrorPostId) {
        mirrorPostIds.add(storedMirrorPostId);
      }
    }

    await Promise.all([
      deleteDoc(eventRef),
      ...Array.from(mirrorPostIds).map(postId => deleteDoc(doc(db, 'posts', postId))),
    ]);
    invalidateSocialPostsQueryCache();
  });
};

export const getEventStartDate = (event: Pick<DroneEvent, 'startsAt' | 'startsAtMs'>) => {
  const timestampMs = getTimestampMillis(event.startsAt) || event.startsAtMs;
  return new Date(timestampMs);
};
