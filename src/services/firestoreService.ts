import {
  FirebaseFirestoreTypes,
  collection,
  documentId,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  GeoPoint,
  getFirestore,
} from '@react-native-firebase/firestore';
import { auth } from '../firebaseConfig';
import {
  retryAsync,
  isRetriableFirestoreError,
  isRetriableNetworkError,
} from '../utils/retry';
import {
  CONTENT_QUERY_CACHE_KEYS,
  invalidateSpotsQueryCache,
  readCachedContentQuery,
} from './contentQueryCache';
import { createSpotPostForSpot } from './socialService';
import logger from '../utils/logger';

const db = getFirestore();
const FIRESTORE_IN_QUERY_LIMIT = 10;

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
        `[Firestore] ${label} attempt ${attempt} failed. Retrying in ${delayMs}ms`,
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
    logger.error(`[Firestore] ${label} failed`, error);
    throw error;
  }
};

const chunkArray = <T,>(items: T[], chunkSize: number) => {
  if (chunkSize <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const getTimestampMillis = (value: unknown) => {
  if (value && typeof (value as {toMillis?: unknown}).toMillis === 'function') {
    return (value as {toMillis: () => number}).toMillis();
  }
  return 0;
};

const sortByCreatedAtDesc = <T extends {createdAt?: unknown}>(items: T[]) =>
  [...items].sort(
    (a, b) =>
      getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt),
  );

// --- Tipos de Datos ---
export interface Spot {
  id?: string;
  parentId?: string; // ID del spot original si este es una versión
  name: string;
  nickname?: string;
  description: string;
  coordinates: FirebaseFirestoreTypes.GeoPoint;
  createdBy: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  averageRating: number;
  reviewCount: number;
  ratingCount?: number;
  mainImage?: string;
  backgroundUrl?: string;
  galleryImages?: string[];
  videoUrl?: string;
  address?: string;
  flightStyles?: string[];
  tags?: string[];
  isHidden?: boolean;
  hiddenBy?: string | null;
  hiddenAt?: FirebaseFirestoreTypes.Timestamp | null;
  featured?: boolean;
  featuredBy?: string | null;
  featuredAt?: FirebaseFirestoreTypes.Timestamp | null;
}

export interface Review {
  id?: string;
  spotId: string;
  userId: string;
  rating?: number;
  text?: string;
  photos?: string[];
  videoUrl?: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  type?: 'rating' | 'comment';
  moderationStatus?: 'approved' | 'rejected' | 'needs_review' | 'hidden';
  moderationNotes?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: FirebaseFirestoreTypes.Timestamp | null;
  reportCount?: number;
}

export type UserModerationStatus = 'active' | 'flagged' | 'blocked' | 'suspended';

export interface UserProfile {
  id?: string;
  displayName: string;
  pilotType?: string | string[];
  pilotTypes?: string[];
  bio?: string;
  cityRegion?: string;
  socials?: {
    youtube?: string;
    instagram?: string;
    facebook?: string;
    linkedin?: string;
    website?: string;
    whatsapp?: string;
    email?: string;
  };
  profilePictureUrl?: string;
  backgroundPictureUrl?: string;
  flightStyles?: string[];
  pilotMarker?: {
    latitude: number;
    longitude: number;
    iconType: 'avatar' | 'color';
    iconValue?: string;
  };
  showPilotMarker?: boolean;
  moderationStatus?: UserModerationStatus;
  moderationNotes?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: FirebaseFirestoreTypes.Timestamp | null;
}

export type AffiliateClickSource = 'map' | 'profile';

export interface AffiliateStore {
  id?: string;
  name: string;
  groupId?: string;
  logoUrl?: string;
  discountLabel?: string;
  affiliateUrl: string;
  isActive?: boolean;
  priority?: number;
}

export interface AffiliateStoreGroup {
  id?: string;
  name: string;
  logoUrl?: string;
  discountLabel?: string;
  displayMode?: 'categories' | 'offers';
  isActive?: boolean;
  priority?: number;
}

export interface AffiliateOffer {
  id?: string;
  groupId: string;
  title: string;
  affiliateUrl: string;
  imageUrl?: string;
  couponCode?: string;
  couponPrice?: string;
  originalPrice?: string;
  discountLabel?: string;
  categories?: string;
  warehouse?: string;
  quantity?: number;
  updatedAt?: FirebaseFirestoreTypes.Timestamp;
  startsAt?: FirebaseFirestoreTypes.Timestamp;
  endsAt?: FirebaseFirestoreTypes.Timestamp;
  isActive?: boolean;
  priority?: number;
}

export interface PilotMarkerMapEntry {
  id: string;
  latitude: number;
  longitude: number;
  photoUrl?: string | null;
  displayName?: string | null;
  cityRegion?: string | null;
}

const isSpotVisible = (spot?: Pick<Spot, 'isHidden'> | null) =>
  spot?.isHidden !== true;

const isReviewVisible = (review?: Pick<Review, 'moderationStatus'> | null) =>
  review?.moderationStatus !== 'hidden' &&
  review?.moderationStatus !== 'rejected';

const ensureCurrentUserIs = (userId: string) => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Usuario no autenticado');
  }
  if (currentUser.uid !== userId) {
    throw new Error('No autorizado');
  }
  return currentUser;
};

// --- Funciones del Servicio ---

export const saveUserProfile = (userId: string, profileData: Partial<UserProfile>) => {
  const userDocRef = doc(db, 'users', userId);
  return wrapFirestoreWrite('saveUserProfile', () =>
    setDoc(userDocRef, profileData, { merge: true }),
  );
};

export const addUserNotificationToken = (userId: string, token: string) => {
  const tokenDocRef = doc(db, 'users', userId, 'notificationTokens', token);
  return wrapFirestoreWrite('addUserNotificationToken', () =>
    setDoc(tokenDocRef, {
      token,
      updatedAt: serverTimestamp(),
    }),
  );
};

export const removeUserNotificationToken = (userId: string, token: string) => {
  const tokenDocRef = doc(db, 'users', userId, 'notificationTokens', token);
  return wrapFirestoreWrite('removeUserNotificationToken', () =>
    deleteDoc(tokenDocRef),
  );
};

export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  const docRef = doc(db, 'users', userId);
  const docSnap = await runResilientFirestoreRead('getUserProfile', () =>
    getDoc(docRef),
  );
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() } as UserProfile;
};

export const getUserProfiles = async (
  userIds: string[],
): Promise<Record<string, UserProfile | null>> => {
  const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!normalizedUserIds.length) {
    return {};
  }

  const profilesByUserId: Record<string, UserProfile | null> = Object.fromEntries(
    normalizedUserIds.map(userId => [userId, null]),
  );
  const userIdChunks = chunkArray(normalizedUserIds, FIRESTORE_IN_QUERY_LIMIT);
  const usersCollectionRef = collection(db, 'users');

  const chunkSnapshots = await Promise.allSettled(
    userIdChunks.map((chunk, chunkIndex) =>
      runResilientFirestoreRead(`getUserProfiles.chunk.${chunkIndex}`, () =>
        getDocs(query(usersCollectionRef, where(documentId(), 'in', chunk))),
      ),
    ),
  );

  let failedChunks = 0;
  chunkSnapshots.forEach(result => {
    if (result.status !== 'fulfilled') {
      failedChunks += 1;
      return;
    }

    result.value.docs.forEach(docSnapshot => {
      profilesByUserId[docSnapshot.id] = {
        id: docSnapshot.id,
        ...docSnapshot.data(),
      } as UserProfile;
    });
  });

  if (failedChunks > 0) {
    logger.warn('[Firestore] getUserProfiles partial failure', {
      failedChunks,
      requestedUserIds: normalizedUserIds.length,
    });
  }

  return profilesByUserId;
};

export const addSpot = async (spotData: {
  name: string;
  nickname?: string;
  description: string;
  latitude: number;
  longitude: number;
  mainImage?: string;
  backgroundUrl?: string;
  address?: string;
  galleryImages?: string[];
  videoUrl?: string;
  flightStyles?: string[];
  tags?: string[];
}) => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Usuario no autenticado para crear un spot.");

  const { latitude, longitude, ...restOfData } = spotData;
  const spotsCollectionRef = collection(db, 'spots');

  return wrapFirestoreWrite('addSpot', async () => {
    const spotRef = await addDoc(spotsCollectionRef, {
      ...restOfData,
      coordinates: new GeoPoint(latitude, longitude),
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      averageRating: 0,
      reviewCount: 0,
      ratingCount: 0,
      isHidden: false,
      featured: false,
    });

    await createSpotPostForSpot({
      spotId: spotRef.id,
      createdBy: currentUser.uid,
      text: restOfData.description,
      media: {
        images: [
          ...(restOfData.mainImage ? [restOfData.mainImage] : []),
          ...(restOfData.galleryImages ?? []),
        ].slice(0, 6),
        videoUrl: restOfData.videoUrl,
        thumbnailUrl: restOfData.mainImage ?? restOfData.galleryImages?.[0],
      },
    });

    invalidateSpotsQueryCache();
    return spotRef;
  });
};

export const getSpots = async (
  options: {includeHidden?: boolean; forceRefresh?: boolean} = {},
): Promise<Spot[]> => {
  const {includeHidden = false, forceRefresh = false} = options;
  const mapped = await readCachedContentQuery({
    key: CONTENT_QUERY_CACHE_KEYS.spots,
    forceRefresh,
    read: async () => {
      const spotsCollectionRef = collection(db, 'spots');
      const snapshot = await runResilientFirestoreRead('getSpots', () =>
        getDocs(spotsCollectionRef),
      );
      return snapshot.docs.map(
        docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as Spot),
      );
    },
  });
  if (includeHidden) {
    return [...mapped];
  }
  return mapped.filter(isSpotVisible);
};

export const getSpot = async (
  spotId: string,
  options: {includeHidden?: boolean} = {},
): Promise<Spot | null> => {
  const {includeHidden = false} = options;
  const docRef = doc(db, 'spots', spotId);
  const docSnap = await runResilientFirestoreRead('getSpot', () =>
    getDoc(docRef),
  );
  if (!docSnap.exists()) return null;
  const spot = {id: docSnap.id, ...docSnap.data()} as Spot;
  if (!includeHidden && !isSpotVisible(spot)) {
    return null;
  }
  return spot;
};

export const getSpotWithVersions = async (
  spotId: string,
  options: {includeHidden?: boolean} = {},
): Promise<Spot[]> => {
  const {includeHidden = false} = options;
  const spot = await getSpot(spotId, {includeHidden});
  if (!spot) return [];

  const parentId = spot.parentId || spot.id;
  
  const spotsCollectionRef = collection(db, 'spots');
  const versionsQuery = query(spotsCollectionRef, where('parentId', '==', parentId));
  const versionsSnapshot = await runResilientFirestoreRead('getSpotVersions', () =>
    getDocs(versionsQuery),
  );
  const versions = versionsSnapshot.docs
    .map(docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as Spot))
    .filter(currentSpot => includeHidden || isSpotVisible(currentSpot));

  const parentSpotDoc = await runResilientFirestoreRead('getParentSpot', () =>
    getDoc(doc(db, 'spots', parentId)),
  );
  const parentSpot = parentSpotDoc.exists()
    ? ({id: parentSpotDoc.id, ...parentSpotDoc.data()} as Spot)
    : null;

  const allSpots = [...versions];
  if (
    parentSpot &&
    (includeHidden || isSpotVisible(parentSpot)) &&
    !allSpots.find(s => s.id === parentSpot.id)
  ) {
    allSpots.push(parentSpot);
  }
  
  return allSpots;
};

export const getSpotsByUserId = async (userId: string): Promise<Spot[]> => {
    const spotsCollectionRef = collection(db, 'spots');
    const userSpotsQuery = query(spotsCollectionRef, where('createdBy', '==', userId));
    const snapshot = await runResilientFirestoreRead('getSpotsByUserId', () =>
      getDocs(userSpotsQuery),
    );
    return snapshot.docs.map(
      docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as Spot),
    );
};

export const updateSpot = async (spotId: string, spotData: Partial<Spot>) => {
    const spotDocRef = doc(db, 'spots', spotId);
    return wrapFirestoreWrite('updateSpot', async () => {
      await updateDoc(spotDocRef, spotData);
      invalidateSpotsQueryCache();
    });
};

export const addReview = async (reviewData: Omit<Review, 'id' | 'createdAt'>) => {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== reviewData.userId) {
        throw new Error("Usuario no autenticado o no autorizado para añadir esta reseña.");
    }

    const payload: Record<string, unknown> = {
        ...reviewData,
        moderationStatus: reviewData.moderationStatus ?? 'approved',
        moderationNotes: reviewData.moderationNotes ?? null,
        moderatedBy: reviewData.moderatedBy ?? null,
        moderatedAt: reviewData.moderatedAt ?? null,
        reportCount: reviewData.reportCount ?? 0,
        createdAt: serverTimestamp(),
    };
    if (payload.rating === undefined) {
        delete payload.rating;
    }
    if (payload.text && typeof payload.text === 'string' && !payload.text.trim()) {
        delete payload.text;
    }

    if (reviewData.type === 'rating') {
        const ratingDocId = `rating_${reviewData.spotId}_${reviewData.userId}`;
        const reviewRef = doc(db, 'reviews', ratingDocId);
        return wrapFirestoreWrite('addReview', async () => {
          await setDoc(reviewRef, payload, { merge: true });
          invalidateSpotsQueryCache();
        });
    }

    const reviewsCollectionRef = collection(db, 'reviews');
    return wrapFirestoreWrite('addReview', async () => {
      const createdReview = await addDoc(reviewsCollectionRef, payload);
      invalidateSpotsQueryCache();
      return createdReview;
    });
};

export const getReviewsForSpot = async (
  spotId: string,
  options: {includeModerated?: boolean} = {},
): Promise<Review[]> => {
    const {includeModerated = false} = options;
    const reviewsCollectionRef = collection(db, 'reviews');
    const reviewsQuery = query(reviewsCollectionRef, where('spotId', '==', spotId), orderBy('createdAt', 'desc'));
    const snapshot = await runResilientFirestoreRead('getReviewsForSpot', () =>
      getDocs(reviewsQuery),
    );
    const reviews = snapshot.docs.map(
      docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as Review),
    );
    if (includeModerated) {
      return reviews;
    }
    return reviews.filter(isReviewVisible);
};

export const deleteSpot = async (spotId: string) => {
    const spotDocRef = doc(db, 'spots', spotId);
    return wrapFirestoreWrite('deleteSpot', async () => {
      await deleteDoc(spotDocRef);
      invalidateSpotsQueryCache();
    });
};

export const deleteUserAccount = async (userId: string) => {
    const user = ensureCurrentUserIs(userId);
    // Auth deletion now acts as the source of truth. A backend trigger removes
    // users/{uid}, which preserves the existing cascade cleanup path.
    return user.delete();
};

export type PilotMarkerPayload = {
  latitude: number;
  longitude: number;
};

const buildPilotMarkerDocument = (payload: PilotMarkerPayload) => ({
  latitude: payload.latitude,
  longitude: payload.longitude,
  iconType: 'avatar',
  iconValue: null,
});

export const setPilotMarker = (userId: string, payload: PilotMarkerPayload) => {
  ensureCurrentUserIs(userId);
  const userDoc = doc(db, 'users', userId);
  return wrapFirestoreWrite('setPilotMarker', () =>
    setDoc(
      userDoc,
      {
        pilotMarker: buildPilotMarkerDocument(payload),
        showPilotMarker: true,
      },
      {merge: true},
    ),
  );
};

export const setPilotMarkerVisibility = (userId: string, visible: boolean) => {
  ensureCurrentUserIs(userId);
  const userDoc = doc(db, 'users', userId);
  return wrapFirestoreWrite('setPilotMarkerVisibility', () =>
    setDoc(
      userDoc,
      {
        showPilotMarker: visible,
      },
      {merge: true},
    ),
  );
};

export const clearPilotMarker = (userId: string) => {
  ensureCurrentUserIs(userId);
  const userDoc = doc(db, 'users', userId);
  return wrapFirestoreWrite('clearPilotMarker', () =>
    setDoc(
      userDoc,
      {
        pilotMarker: null,
        showPilotMarker: false,
      },
      {merge: true},
    ),
  );
};

export const getPublicPilotMarkers = async (): Promise<PilotMarkerMapEntry[]> => {
  const usersCollectionRef = collection(db, 'users');
  const visibilityQuery = query(
    usersCollectionRef,
    where('showPilotMarker', '==', true),
  );
  const snapshot = await runResilientFirestoreRead('getPublicPilotMarkers', () =>
    getDocs(visibilityQuery),
  );
  return snapshot.docs
    .map(docSnapshot => {
      const data = docSnapshot.data() as UserProfile;
      const marker = data.pilotMarker;
      if (
        marker &&
        typeof marker.latitude === 'number' &&
        typeof marker.longitude === 'number'
      ) {
        return {
          id: docSnapshot.id,
          latitude: marker.latitude,
          longitude: marker.longitude,
          photoUrl: data.profilePictureUrl ?? null,
          displayName: data.displayName ?? null,
          cityRegion: data.cityRegion ?? null,
        } as PilotMarkerMapEntry;
      }
      return null;
    })
    .filter((entry): entry is PilotMarkerMapEntry => Boolean(entry));
};

export const isCurrentUserAdmin = async (): Promise<boolean> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return false;
  }
  const adminDoc = await runResilientFirestoreRead('isCurrentUserAdmin', () =>
    getDoc(doc(db, 'adminUsers', currentUser.uid)),
  );
  return adminDoc.exists();
};

export const getAllSpotsForAdmin = async (): Promise<Spot[]> =>
  getSpots({includeHidden: true});

export const getAllReviews = async (
  options: {includeModerated?: boolean} = {},
): Promise<Review[]> => {
  const {includeModerated = true} = options;
  const reviewsCollectionRef = collection(db, 'reviews');
  const reviewsQuery = query(reviewsCollectionRef, orderBy('createdAt', 'desc'));
  const snapshot = await runResilientFirestoreRead('getAllReviews', () =>
    getDocs(reviewsQuery),
  );
  const reviews = snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as Review),
  );
  if (includeModerated) {
    return reviews;
  }
  return reviews.filter(isReviewVisible);
};

export const getReviewsForSpots = async (
  spotIds: string[],
  options: {includeModerated?: boolean} = {},
): Promise<Record<string, Review[]>> => {
  const {includeModerated = false} = options;
  const normalizedSpotIds = Array.from(new Set(spotIds.filter(Boolean)));
  if (!normalizedSpotIds.length) {
    return {};
  }

  const reviewsBySpotId: Record<string, Review[]> = Object.fromEntries(
    normalizedSpotIds.map(spotId => [spotId, []]),
  );
  const reviewsCollectionRef = collection(db, 'reviews');
  const spotIdChunks = chunkArray(normalizedSpotIds, FIRESTORE_IN_QUERY_LIMIT);

  const chunkSnapshots = await Promise.allSettled(
    spotIdChunks.map((chunk, chunkIndex) =>
      runResilientFirestoreRead(`getReviewsForSpots.chunk.${chunkIndex}`, () =>
        getDocs(query(reviewsCollectionRef, where('spotId', 'in', chunk))),
      ),
    ),
  );

  let failedChunks = 0;
  chunkSnapshots.forEach(result => {
    if (result.status !== 'fulfilled') {
      failedChunks += 1;
      return;
    }

    result.value.docs.forEach(docSnapshot => {
      const review = {id: docSnapshot.id, ...docSnapshot.data()} as Review;
      if (!review.spotId || !(review.spotId in reviewsBySpotId)) {
        return;
      }
      reviewsBySpotId[review.spotId].push(review);
    });
  });

  Object.keys(reviewsBySpotId).forEach(spotId => {
    const sortedReviews = sortByCreatedAtDesc(reviewsBySpotId[spotId]);
    reviewsBySpotId[spotId] = includeModerated
      ? sortedReviews
      : sortedReviews.filter(isReviewVisible);
  });

  if (failedChunks > 0) {
    logger.warn('[Firestore] getReviewsForSpots partial failure', {
      failedChunks,
      requestedSpotIds: normalizedSpotIds.length,
    });
  }

  return reviewsBySpotId;
};

export const getAllUsers = async (): Promise<UserProfile[]> => {
  const usersCollectionRef = collection(db, 'users');
  const snapshot = await runResilientFirestoreRead('getAllUsers', () =>
    getDocs(usersCollectionRef),
  );
  return snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as UserProfile),
  );
};

const ensureSignedInUser = () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Usuario no autenticado');
  }
  return currentUser;
};

export const setSpotHiddenState = async (spotId: string, hidden: boolean) => {
  const currentUser = ensureSignedInUser();
  const spotDocRef = doc(db, 'spots', spotId);
  return wrapFirestoreWrite('setSpotHiddenState', async () => {
    await updateDoc(spotDocRef, {
      isHidden: hidden,
      hiddenBy: hidden ? currentUser.uid : null,
      hiddenAt: hidden ? serverTimestamp() : null,
    });
    invalidateSpotsQueryCache();
  });
};

export const setSpotFeaturedState = async (spotId: string, featured: boolean) => {
  const currentUser = ensureSignedInUser();
  const spotDocRef = doc(db, 'spots', spotId);
  return wrapFirestoreWrite('setSpotFeaturedState', async () => {
    await updateDoc(spotDocRef, {
      featured,
      featuredBy: featured ? currentUser.uid : null,
      featuredAt: featured ? serverTimestamp() : null,
    });
    invalidateSpotsQueryCache();
  });
};

export const deleteSpotAsAdmin = async (spotId: string) =>
  wrapFirestoreWrite('deleteSpotAsAdmin', async () => {
    await deleteDoc(doc(db, 'spots', spotId));
    invalidateSpotsQueryCache();
  });

export const setReviewModerationStatus = async (
  reviewId: string,
  moderationStatus: Review['moderationStatus'],
  moderationNotes?: string | null,
) => {
  const currentUser = ensureSignedInUser();
  const reviewDocRef = doc(db, 'reviews', reviewId);
  return wrapFirestoreWrite('setReviewModerationStatus', async () => {
    await updateDoc(reviewDocRef, {
      moderationStatus: moderationStatus ?? 'approved',
      moderationNotes: moderationNotes ?? null,
      moderatedBy: currentUser.uid,
      moderatedAt: serverTimestamp(),
    });
    invalidateSpotsQueryCache();
  });
};

export const deleteReviewAsAdmin = async (reviewId: string) =>
  wrapFirestoreWrite('deleteReviewAsAdmin', async () => {
    await deleteDoc(doc(db, 'reviews', reviewId));
    invalidateSpotsQueryCache();
  });

export const setUserModerationStatus = async (
  userId: string,
  moderationStatus: UserModerationStatus,
  moderationNotes?: string | null,
) => {
  const currentUser = ensureSignedInUser();
  const userDocRef = doc(db, 'users', userId);
  return wrapFirestoreWrite('setUserModerationStatus', () =>
    updateDoc(userDocRef, {
      moderationStatus,
      moderationNotes: moderationNotes ?? null,
      moderatedBy: currentUser.uid,
      moderatedAt: serverTimestamp(),
    }),
  );
};

export const getAffiliateStores = async (): Promise<AffiliateStore[]> => {
  const storesCollectionRef = collection(db, 'affiliateStores');
  const snapshot = await runResilientFirestoreRead('getAffiliateStores', () =>
    getDocs(storesCollectionRef),
  );
  return snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as AffiliateStore),
  );
};

export const getAffiliateStoreGroups = async (): Promise<AffiliateStoreGroup[]> => {
  const groupsCollectionRef = collection(db, 'affiliateStoreGroups');
  const snapshot = await runResilientFirestoreRead('getAffiliateStoreGroups', () =>
    getDocs(groupsCollectionRef),
  );
  return snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as AffiliateStoreGroup),
  );
};

export const getAffiliateOffersForGroup = async (
  groupId: string,
): Promise<AffiliateOffer[]> => {
  const offersCollectionRef = collection(db, 'affiliateOffers');
  const offersQuery = query(offersCollectionRef, where('groupId', '==', groupId));
  const snapshot = await runResilientFirestoreRead(
    'getAffiliateOffersForGroup',
    () => getDocs(offersQuery),
  );
  return snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as AffiliateOffer),
  );
};

export const trackAffiliateClick = async ({
  storeId,
  storeName,
  source,
}: {
  storeId: string;
  storeName: string;
  source: AffiliateClickSource;
}) => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    logger.warn('[trackAffiliateClick] No authenticated user');
    return Promise.resolve();
  }
  const clicksCollectionRef = collection(db, 'affiliateClicks');
  return wrapFirestoreWrite('trackAffiliateClick', () =>
    addDoc(clicksCollectionRef, {
      storeId,
      storeName,
      source,
      userId: currentUser.uid,
      createdAt: serverTimestamp(),
    }),
  );
};
