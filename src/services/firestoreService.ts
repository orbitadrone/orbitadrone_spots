import {
  FirebaseFirestoreTypes,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  runTransaction,
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

const db = getFirestore();

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
      console.warn(
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
    console.error(`[Firestore] ${label} failed`, error);
    throw error;
  }
};

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
  moderationStatus?: 'approved' | 'rejected' | 'needs_review';
  moderationNotes?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: FirebaseFirestoreTypes.Timestamp | null;
  reportCount?: number;
}

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
}

export interface PilotMarkerMapEntry {
  id: string;
  latitude: number;
  longitude: number;
  photoUrl?: string | null;
  displayName?: string | null;
  cityRegion?: string | null;
}

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
  if (!docSnap.exists) return null;
  return { id: docSnap.id, ...docSnap.data() } as UserProfile;
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

  return wrapFirestoreWrite('addSpot', () =>
    addDoc(spotsCollectionRef, {
      ...restOfData,
      coordinates: new GeoPoint(latitude, longitude),
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      averageRating: 0,
      reviewCount: 0,
    }),
  );
};

export const getSpots = async (): Promise<Spot[]> => {
  const spotsCollectionRef = collection(db, 'spots');
  const snapshot = await runResilientFirestoreRead('getSpots', () =>
    getDocs(spotsCollectionRef),
  );
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Spot));
};

export const getSpot = async (spotId: string): Promise<Spot | null> => {
  const docRef = doc(db, 'spots', spotId);
  const docSnap = await runResilientFirestoreRead('getSpot', () =>
    getDoc(docRef),
  );
  if (!docSnap.exists) return null;
  return { id: docSnap.id, ...docSnap.data() } as Spot;
};

export const getSpotWithVersions = async (spotId: string): Promise<Spot[]> => {
  const spot = await getSpot(spotId);
  if (!spot) return [];

  const parentId = spot.parentId || spot.id;
  
  const spotsCollectionRef = collection(db, 'spots');
  const versionsQuery = query(spotsCollectionRef, where('parentId', '==', parentId));
  const versionsSnapshot = await runResilientFirestoreRead('getSpotVersions', () =>
    getDocs(versionsQuery),
  );
  const versions = versionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Spot));

  const parentSpotDoc = await runResilientFirestoreRead('getParentSpot', () =>
    getDoc(doc(db, 'spots', parentId)),
  );
  const parentSpot = parentSpotDoc.exists ? { id: parentSpotDoc.id, ...parentSpotDoc.data() } as Spot : null;

  const allSpots = [...versions];
  if (parentSpot && !allSpots.find(s => s.id === parentSpot.id)) {
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
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Spot));
};

export const updateSpot = async (spotId: string, spotData: Partial<Spot>) => {
    const spotDocRef = doc(db, 'spots', spotId);
    return wrapFirestoreWrite('updateSpot', () => updateDoc(spotDocRef, spotData));
};

export const addReview = async (reviewData: Omit<Review, 'id' | 'createdAt'>) => {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== reviewData.userId) {
        throw new Error("Usuario no autenticado o no autorizado para añadir esta reseña.");
    }

    const spotRef = doc(db, 'spots', reviewData.spotId);
    const reviewRef = doc(collection(db, 'reviews')); // Create a ref for a new doc

    return wrapFirestoreWrite('addReview', () =>
      runTransaction(db, async transaction => {
        const spotDoc = await transaction.get(spotRef);
        if (!spotDoc.exists()) {
            throw "El spot no existe!";
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
        transaction.set(reviewRef, payload);

        const spotData = spotDoc.data() as Spot;
        const existingReviewCount = spotData.reviewCount || 0;
        const existingRatingCount = spotData.ratingCount ?? spotData.reviewCount ?? 0;
        const hasRating = typeof reviewData.rating === 'number' && reviewData.rating > 0;

        let newRatingCount = existingRatingCount;
        let newAverageRating = spotData.averageRating || 0;

        const currentRatingTotal = newAverageRating * existingRatingCount;

        if (hasRating) {
            newRatingCount = existingRatingCount + 1;
            newAverageRating =
                (currentRatingTotal + (reviewData.rating as number)) /
                (newRatingCount || 1);
        } else if (existingRatingCount > 0) {
            newAverageRating = currentRatingTotal / existingRatingCount;
        } else {
            newAverageRating = 0;
        }

        transaction.update(spotRef, {
            reviewCount: existingReviewCount + 1,
            averageRating: newAverageRating,
            ratingCount: newRatingCount,
        });
      }),
    );
};

export const getReviewsForSpot = async (spotId: string): Promise<Review[]> => {
    const reviewsCollectionRef = collection(db, 'reviews');
    const reviewsQuery = query(reviewsCollectionRef, where('spotId', '==', spotId), orderBy('createdAt', 'desc'));
    const snapshot = await runResilientFirestoreRead('getReviewsForSpot', () =>
      getDocs(reviewsQuery),
    );
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Review));
};

export const deleteSpot = async (spotId: string) => {
    const spotDocRef = doc(db, 'spots', spotId);
    return wrapFirestoreWrite('deleteSpot', () => deleteDoc(spotDocRef));
};

export const deleteUserAccount = async (userId: string) => {
    const user = ensureCurrentUserIs(userId);
    const userDocRef = doc(db, 'users', userId);
    await wrapFirestoreWrite('deleteUserAccountDoc', () => deleteDoc(userDocRef));
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
