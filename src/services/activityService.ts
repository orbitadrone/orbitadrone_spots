import {
  FirebaseFirestoreTypes,
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@react-native-firebase/firestore';

import logger from '../utils/logger';

export type ActivityLevel = 'info' | 'success' | 'error';

export type ActivityItemType =
  | 'spot_review'
  | 'post_comment'
  | 'post_like'
  | 'event_invite'
  | 'event_request'
  | 'event_approved'
  | 'event_attending'
  | 'event_declined'
  | string;

export type ActivityItem = {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: ActivityItemType;
  createdAt?: FirebaseFirestoreTypes.Timestamp;
  createdAtMs: number;
  isRead: boolean;
  readAt?: FirebaseFirestoreTypes.Timestamp | null;
  level: ActivityLevel;
  link?: string | null;
  postId?: string | null;
  spotId?: string | null;
  eventId?: string | null;
  reviewId?: string | null;
  commentId?: string | null;
  likeId?: string | null;
  participantId?: string | null;
};

const db = getFirestore();
const ACTIVITY_ITEMS_LIMIT = 50;

const getActivityCollection = (userId: string) => collection(db, 'users', userId, 'activity');

const mapActivityDoc = (
  snapshot: FirebaseFirestoreTypes.QueryDocumentSnapshot<FirebaseFirestoreTypes.DocumentData>,
): ActivityItem => {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    userId: typeof data.userId === 'string' ? data.userId : '',
    title: typeof data.title === 'string' ? data.title : '',
    body: typeof data.body === 'string' ? data.body : '',
    type: typeof data.type === 'string' ? data.type : 'system_info',
    createdAt: data.createdAt,
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
    isRead: data.isRead === true,
    readAt: data.readAt ?? null,
    level:
      data.level === 'success' || data.level === 'error' || data.level === 'info'
        ? data.level
        : 'info',
    link: typeof data.link === 'string' ? data.link : null,
    postId: typeof data.postId === 'string' ? data.postId : null,
    spotId: typeof data.spotId === 'string' ? data.spotId : null,
    eventId: typeof data.eventId === 'string' ? data.eventId : null,
    reviewId: typeof data.reviewId === 'string' ? data.reviewId : null,
    commentId: typeof data.commentId === 'string' ? data.commentId : null,
    likeId: typeof data.likeId === 'string' ? data.likeId : null,
    participantId: typeof data.participantId === 'string' ? data.participantId : null,
  };
};

export const subscribeToActivityFeed = (
  userId: string,
  onItems: (items: ActivityItem[]) => void,
  onError?: (error: unknown) => void,
) => {
  const feedQuery = query(
    getActivityCollection(userId),
    orderBy('createdAt', 'desc'),
    limit(ACTIVITY_ITEMS_LIMIT),
  );

  return onSnapshot(
    feedQuery,
    snapshot => {
      onItems(snapshot.docs.map(mapActivityDoc));
    },
    error => {
      logger.warn('[Activity] subscribe failed', error);
      onError?.(error);
    },
  );
};

export const markActivityItemRead = async (userId: string, activityId: string) => {
  await updateDoc(doc(db, 'users', userId, 'activity', activityId), {
    isRead: true,
    readAt: serverTimestamp(),
  });
};

export const markAllActivityItemsRead = async (userId: string, activityIds: string[]) => {
  await Promise.all(activityIds.map(activityId => markActivityItemRead(userId, activityId)));
};

export const getActivityItemDeepLink = (item: ActivityItem) => {
  if (item.link) {
    return item.link;
  }
  if (item.spotId) {
    return `orbitadrone://spot/${encodeURIComponent(item.spotId)}`;
  }
  if (item.eventId) {
    return `orbitadrone://event/${encodeURIComponent(item.eventId)}`;
  }
  if (item.postId) {
    return `orbitadrone://feed?postId=${encodeURIComponent(item.postId)}`;
  }
  return null;
};
