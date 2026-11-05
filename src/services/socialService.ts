import {
  FirebaseFirestoreTypes,
  addDoc,
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
import {
  CONTENT_QUERY_CACHE_KEYS,
  invalidateSocialPostsQueryCache,
  readCachedContentQuery,
} from './contentQueryCache';
import {requireAuthenticatedUser} from './authSession';
import type {EventPublicJoinMode} from './eventService';
import logger from '../utils/logger';

export type PostType = 'spot' | 'drone' | 'event' | 'ad';

export type EventPostMeta = {
  title: string;
  startsAtMs: number;
  locationLabel?: string | null;
  locationAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isPublic: boolean;
  publicJoinMode?: EventPublicJoinMode;
  coverImageUrl?: string | null;
};

export interface SocialPost {
  id?: string;
  type: PostType;
  createdBy: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  createdAtMs?: number;
  text?: string;
  spotId?: string;
  eventId?: string;
  media?: {
    images?: string[];
    videoUrl?: string;
    thumbnailUrl?: string;
  };
  eventMeta?: EventPostMeta;
  isHidden?: boolean;
  hiddenBy?: string | null;
  hiddenAt?: FirebaseFirestoreTypes.Timestamp | null;
  featured?: boolean;
  featuredBy?: string | null;
  featuredAt?: FirebaseFirestoreTypes.Timestamp | null;
}

export interface PostComment {
  id?: string;
  postId: string;
  userId: string;
  text: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  moderationStatus?: 'approved' | 'hidden' | 'rejected';
  moderationNotes?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: FirebaseFirestoreTypes.Timestamp | null;
}

export interface PostLike {
  id?: string;
  postId: string;
  postType: PostType;
  userId: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
}

export interface ContentReport {
  id?: string;
  targetType: 'spot' | 'review' | 'post' | 'postComment' | 'user';
  targetId: string;
  contextPostId?: string | null;
  contextSpotId?: string | null;
  reasons: string[];
  note?: string;
  createdBy: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
  status?: 'open' | 'in_review' | 'resolved' | 'dismissed';
  reviewedBy?: string | null;
  reviewedAt?: FirebaseFirestoreTypes.Timestamp | null;
}

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

const ensureSignedInUser = () => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Usuario no autenticado');
  }
  return currentUser;
};

const ensureSignedInUserAsync = async (context: string) =>
  auth.currentUser ?? requireAuthenticatedUser(context);

export const getSpotPostDocId = (spotId: string) => `spot_${spotId}`;

export const createSpotPostForSpot = async ({
  spotId,
  createdBy,
  text,
  media,
}: {
  spotId: string;
  createdBy: string;
  text?: string;
  media?: {
    images?: string[];
    videoUrl?: string;
    thumbnailUrl?: string;
  };
}) => {
  const postRef = doc(db, 'posts', getSpotPostDocId(spotId));
  return wrapFirestoreWrite('createSpotPostForSpot', async () => {
    await setDoc(
      postRef,
      {
        type: 'spot',
        spotId,
        createdBy,
        text: text ?? '',
        createdAtMs: Date.now(),
        media: media ?? {},
        createdAt: serverTimestamp(),
        isHidden: false,
        featured: false,
      },
      {merge: true},
    );
    invalidateSocialPostsQueryCache();
  });
};

export const createDronePost = async ({
  text,
  images,
  videoUrl,
  thumbnailUrl,
}: {
  text?: string;
  images?: string[];
  videoUrl?: string;
  thumbnailUrl?: string;
}) => {
  const currentUser = await ensureSignedInUserAsync('createDronePost');
  const postsCollectionRef = collection(db, 'posts');
  return wrapFirestoreWrite('createDronePost', async () => {
    const createdPost = await addDoc(postsCollectionRef, {
      type: 'drone',
      createdBy: currentUser.uid,
      text: text ?? '',
      createdAtMs: Date.now(),
      media: {
        images: images ?? [],
        videoUrl: videoUrl ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
      },
      createdAt: serverTimestamp(),
      isHidden: false,
      featured: false,
    });
    invalidateSocialPostsQueryCache();
    return createdPost;
  });
};

const isPostVisible = (post?: Pick<SocialPost, 'isHidden'> | null) =>
  post?.isHidden !== true;

export const getSocialPosts = async (
  options: {includeHidden?: boolean; forceRefresh?: boolean} = {},
): Promise<SocialPost[]> => {
  const {includeHidden = false, forceRefresh = false} = options;
  const posts = await readCachedContentQuery({
    key: CONTENT_QUERY_CACHE_KEYS.socialPosts,
    forceRefresh,
    read: async () => {
      const postsCollectionRef = collection(db, 'posts');
      const postsQuery = query(postsCollectionRef, orderBy('createdAt', 'desc'));
      const snapshot = await runResilientFirestoreRead('getSocialPosts', () =>
        getDocs(postsQuery),
      );
      return snapshot.docs.map(
        docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as SocialPost),
      );
    },
  });
  if (includeHidden) {
    return [...posts];
  }
  return posts.filter(isPostVisible);
};

export const getSocialPostsByUser = async (
  userId: string,
  options: {includeHidden?: boolean} = {},
): Promise<SocialPost[]> => {
  const {includeHidden = false} = options;
  const postsCollectionRef = collection(db, 'posts');
  const postsQuery = query(postsCollectionRef, where('createdBy', '==', userId));
  const snapshot = await runResilientFirestoreRead('getSocialPostsByUser', () =>
    getDocs(postsQuery),
  );
  const posts = snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as SocialPost),
  );
  if (includeHidden) {
    return posts;
  }
  return posts.filter(isPostVisible);
};

export const setPostHiddenState = async (postId: string, hidden: boolean) => {
  const currentUser = ensureSignedInUser();
  return wrapFirestoreWrite('setPostHiddenState', async () => {
    await updateDoc(doc(db, 'posts', postId), {
      isHidden: hidden,
      hiddenBy: hidden ? currentUser.uid : null,
      hiddenAt: hidden ? serverTimestamp() : null,
    });
    invalidateSocialPostsQueryCache();
  });
};

export const setPostFeaturedState = async (postId: string, featured: boolean) => {
  const currentUser = ensureSignedInUser();
  return wrapFirestoreWrite('setPostFeaturedState', async () => {
    await updateDoc(doc(db, 'posts', postId), {
      featured,
      featuredBy: featured ? currentUser.uid : null,
      featuredAt: featured ? serverTimestamp() : null,
    });
    invalidateSocialPostsQueryCache();
  });
};

export const deletePostAsAdmin = async (postId: string) =>
  wrapFirestoreWrite('deletePostAsAdmin', async () => {
    await deleteDoc(doc(db, 'posts', postId));
    invalidateSocialPostsQueryCache();
  });

export const deletePost = async (postId: string) => {
  const currentUser = await ensureSignedInUserAsync('deletePost');
  const postRef = doc(db, 'posts', postId);
  const postSnapshot = await runResilientFirestoreRead('deletePost.get', () =>
    getDoc(postRef),
  );
  if (!postSnapshot.exists()) {
    return;
  }
  const post = postSnapshot.data() as SocialPost;
  if (post.createdBy !== currentUser.uid) {
    throw new Error('No autorizado para eliminar esta publicación.');
  }
  return wrapFirestoreWrite('deletePost', async () => {
    await deleteDoc(postRef);
    invalidateSocialPostsQueryCache();
  });
};

export const addPostComment = async ({
  postId,
  text,
}: {
  postId: string;
  text: string;
}) => {
  const currentUser = await ensureSignedInUserAsync('addPostComment');
  const content = text.trim();
  if (!content) {
    throw new Error('Comentario vacío');
  }
  const commentsCollectionRef = collection(db, 'postComments');
  return wrapFirestoreWrite('addPostComment', () =>
    addDoc(commentsCollectionRef, {
      postId,
      userId: currentUser.uid,
      text: content,
      createdAt: serverTimestamp(),
      moderationStatus: 'approved',
      moderationNotes: null,
      moderatedBy: null,
      moderatedAt: null,
    }),
  );
};

const isPostCommentVisible = (
  comment?: Pick<PostComment, 'moderationStatus'> | null,
) =>
  comment?.moderationStatus !== 'hidden' &&
  comment?.moderationStatus !== 'rejected';

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

export const getPostComments = async (
  postId: string,
  options: {includeModerated?: boolean} = {},
): Promise<PostComment[]> => {
  const {includeModerated = false} = options;
  const commentsCollectionRef = collection(db, 'postComments');
  // Avoid requiring a composite index in debug/prod for postId + createdAt.
  // We sort client-side by createdAt descending after reading.
  const commentsQuery = query(
    commentsCollectionRef,
    where('postId', '==', postId),
  );
  const snapshot = await runResilientFirestoreRead('getPostComments', () =>
    getDocs(commentsQuery),
  );
  const comments = snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as PostComment),
  ).sort(
    (a, b) =>
      getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt),
  );
  if (includeModerated) {
    return comments;
  }
  return comments.filter(isPostCommentVisible);
};

export const getPostCommentsForPosts = async (
  postIds: string[],
  options: {includeModerated?: boolean} = {},
): Promise<Record<string, PostComment[]>> => {
  const {includeModerated = false} = options;
  const normalizedPostIds = Array.from(new Set(postIds.filter(Boolean)));
  if (!normalizedPostIds.length) {
    return {};
  }

  const commentsByPostId: Record<string, PostComment[]> = Object.fromEntries(
    normalizedPostIds.map(postId => [postId, []]),
  );
  const commentsCollectionRef = collection(db, 'postComments');
  const postIdChunks = chunkArray(normalizedPostIds, FIRESTORE_IN_QUERY_LIMIT);

  const chunkSnapshots = await Promise.allSettled(
    postIdChunks.map((chunk, chunkIndex) =>
      runResilientFirestoreRead(`getPostCommentsForPosts.chunk.${chunkIndex}`, () =>
        getDocs(query(commentsCollectionRef, where('postId', 'in', chunk))),
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
      const comment = {id: docSnapshot.id, ...docSnapshot.data()} as PostComment;
      if (!comment.postId || !(comment.postId in commentsByPostId)) {
        return;
      }
      commentsByPostId[comment.postId].push(comment);
    });
  });

  Object.keys(commentsByPostId).forEach(postId => {
    const sortedComments = sortByCreatedAtDesc(commentsByPostId[postId]);
    commentsByPostId[postId] = includeModerated
      ? sortedComments
      : sortedComments.filter(isPostCommentVisible);
  });

  if (failedChunks > 0) {
    logger.warn('[Firestore] getPostCommentsForPosts partial failure', {
      failedChunks,
      requestedPostIds: normalizedPostIds.length,
    });
  }

  return commentsByPostId;
};

export const getAllPostComments = async (
  options: {includeModerated?: boolean} = {},
): Promise<PostComment[]> => {
  const {includeModerated = true} = options;
  const commentsCollectionRef = collection(db, 'postComments');
  const commentsQuery = query(commentsCollectionRef, orderBy('createdAt', 'desc'));
  const snapshot = await runResilientFirestoreRead('getAllPostComments', () =>
    getDocs(commentsQuery),
  );
  const comments = snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as PostComment),
  );
  if (includeModerated) {
    return comments;
  }
  return comments.filter(isPostCommentVisible);
};

export const setPostCommentModerationStatus = async (
  commentId: string,
  moderationStatus: PostComment['moderationStatus'],
  moderationNotes?: string | null,
) => {
  const currentUser = ensureSignedInUser();
  return wrapFirestoreWrite('setPostCommentModerationStatus', () =>
    updateDoc(doc(db, 'postComments', commentId), {
      moderationStatus: moderationStatus ?? 'approved',
      moderationNotes: moderationNotes ?? null,
      moderatedBy: currentUser.uid,
      moderatedAt: serverTimestamp(),
    }),
  );
};

export const deletePostCommentAsAdmin = async (commentId: string) =>
  wrapFirestoreWrite('deletePostCommentAsAdmin', () =>
    deleteDoc(doc(db, 'postComments', commentId)),
  );

const buildLikeDocId = (postType: PostType, postId: string, userId: string) =>
  `${postType}_${postId}_${userId}`;

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

export const togglePostLike = async ({
  postId,
  postType,
}: {
  postId: string;
  postType: PostType;
}) => {
  const currentUser = await ensureSignedInUserAsync('togglePostLike');
  const likeDocId = buildLikeDocId(postType, postId, currentUser.uid);
  const likeDocRef = doc(db, 'likes', likeDocId);
  const likeDoc = await runResilientFirestoreRead('togglePostLike.get', () =>
    getDoc(likeDocRef),
  );

  if (likeDoc.exists()) {
    await wrapFirestoreWrite('togglePostLike.delete', () => deleteDoc(likeDocRef));
    return {liked: false};
  }

  await wrapFirestoreWrite('togglePostLike.create', () =>
    setDoc(likeDocRef, {
      postId,
      postType,
      userId: currentUser.uid,
      createdAt: serverTimestamp(),
    }),
  );
  return {liked: true};
};

export const getLikesForPosts = async (
  postIds: string[],
): Promise<{
  countsByPostId: Record<string, number>;
  likedByCurrentUser: Record<string, boolean>;
}> => {
  const normalizedPostIds = Array.from(new Set(postIds.filter(Boolean)));
  if (!normalizedPostIds.length) {
    return {countsByPostId: {}, likedByCurrentUser: {}};
  }

  const likesCollectionRef = collection(db, 'likes');

  const countsByPostId: Record<string, number> = {};
  const likedByCurrentUser: Record<string, boolean> = {};
  const currentUserId = auth.currentUser?.uid;

  const postIdChunks = chunkArray(normalizedPostIds, FIRESTORE_IN_QUERY_LIMIT);
  const chunkSnapshots = await Promise.all(
    postIdChunks.map((chunk, chunkIndex) =>
      runResilientFirestoreRead(`getLikesForPosts.chunk.${chunkIndex}`, () =>
        getDocs(query(likesCollectionRef, where('postId', 'in', chunk))),
      ),
    ),
  );

  chunkSnapshots.forEach(snapshot => {
    snapshot.docs.forEach(docSnapshot => {
      const data = docSnapshot.data() as PostLike;
      if (!data.postId) {
        return;
      }
      countsByPostId[data.postId] = (countsByPostId[data.postId] ?? 0) + 1;
      if (currentUserId && data.userId === currentUserId) {
        likedByCurrentUser[data.postId] = true;
      }
    });
  });

  return {countsByPostId, likedByCurrentUser};
};

export const getLikesReceivedSummaryForPostIds = async (
  postIds: string[],
): Promise<Record<string, number>> => {
  const {countsByPostId} = await getLikesForPosts(postIds);
  return countsByPostId;
};

export const submitContentReport = async ({
  targetType,
  targetId,
  reasons,
  note,
  contextPostId,
  contextSpotId,
}: {
  targetType: ContentReport['targetType'];
  targetId: string;
  reasons: string[];
  note?: string;
  contextPostId?: string | null;
  contextSpotId?: string | null;
}) => {
  const currentUser = await ensureSignedInUserAsync('submitContentReport');
  const cleanReasons = reasons.map(reason => reason.trim()).filter(Boolean);
  if (!cleanReasons.length) {
    throw new Error('Debes seleccionar al menos un motivo');
  }

  const reportsCollectionRef = collection(db, 'reports');
  return wrapFirestoreWrite('submitContentReport', () =>
    addDoc(reportsCollectionRef, {
      targetType,
      targetId,
      contextPostId: contextPostId ?? null,
      contextSpotId: contextSpotId ?? null,
      reasons: cleanReasons,
      note: note?.trim() ?? '',
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      status: 'open',
      reviewedBy: null,
      reviewedAt: null,
    }),
  );
};

export const getAllReports = async (): Promise<ContentReport[]> => {
  const reportsCollectionRef = collection(db, 'reports');
  const reportsQuery = query(reportsCollectionRef, orderBy('createdAt', 'desc'));
  const snapshot = await runResilientFirestoreRead('getAllReports', () =>
    getDocs(reportsQuery),
  );
  return snapshot.docs.map(
    docSnapshot => ({id: docSnapshot.id, ...docSnapshot.data()} as ContentReport),
  );
};

export const updateReportStatus = async (
  reportId: string,
  status: ContentReport['status'],
) => {
  const currentUser = ensureSignedInUser();
  return wrapFirestoreWrite('updateReportStatus', () =>
    updateDoc(doc(db, 'reports', reportId), {
      status: status ?? 'open',
      reviewedBy: currentUser.uid,
      reviewedAt: serverTimestamp(),
    }),
  );
};
