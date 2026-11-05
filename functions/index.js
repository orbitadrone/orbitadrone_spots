const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

// Opcional: limitar concurrencia global de las funciones para controlar costes
functions.logger.log("[Init] Functions config loaded");

admin.initializeApp();
const db = admin.firestore();
const FEED_DEEP_LINK_BASE = "orbitadrone://feed";
const EVENT_DEEP_LINK_BASE = "orbitadrone://event";
const BATCH_DELETE_LIMIT = 400;
const PERMANENT_FCM_TOKEN_ERRORS = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
]);

const buildFeedPostDeepLink = (postId) =>
    `${FEED_DEEP_LINK_BASE}?postId=${encodeURIComponent(postId)}`;

const buildEventDeepLink = (eventId) =>
    `${EVENT_DEEP_LINK_BASE}/${encodeURIComponent(eventId)}`;

const chunkArray = (items, chunkSize) => {
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
};

const deleteDocumentRefs = async (docRefs, logPrefix) => {
    if (!docRefs.length) {
        return 0;
    }
    let deletedCount = 0;
    for (const refsChunk of chunkArray(docRefs, BATCH_DELETE_LIMIT)) {
        const batch = db.batch();
        refsChunk.forEach((docRef) => batch.delete(docRef));
        await batch.commit();
        deletedCount += refsChunk.length;
    }
    console.log(`[${logPrefix}] Deleted ${deletedCount} documents`);
    return deletedCount;
};

const deleteCollectionDocsWhere = async ({
    collectionPath,
    field,
    value,
    logPrefix,
    predicate,
}) => {
    if (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return 0;
    }

    const snapshot = await db.collection(collectionPath).where(field, "==", value).get();
    if (snapshot.empty) {
        return 0;
    }

    const docRefs = snapshot.docs
        .filter((docSnapshot) =>
            typeof predicate === "function" ?
                predicate(docSnapshot.data() || {}, docSnapshot.id) :
                true)
        .map((docSnapshot) => docSnapshot.ref);

    return deleteDocumentRefs(docRefs, logPrefix);
};

const deleteAllDocsInCollection = async (collectionPath, logPrefix) => {
    const snapshot = await db.collection(collectionPath).get();
    if (snapshot.empty) {
        return 0;
    }
    return deleteDocumentRefs(
        snapshot.docs.map((docSnapshot) => docSnapshot.ref),
        logPrefix,
    );
};

const deleteDocIfExists = async (docPath, logPrefix) => {
    const docRef = db.doc(docPath);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
        return 0;
    }
    await docRef.delete();
    console.log(`[${logPrefix}] Deleted ${docPath}`);
    return 1;
};

const getNotificationTokensForUser = async (userId) => {
    const tokensSnap = await db
        .collection(`users/${userId}/notificationTokens`)
        .get();
    if (tokensSnap.empty) {
        return [];
    }
    return tokensSnap.docs
        .map((doc) => doc.id)
        .filter((token) => typeof token === "string" && token.length > 0);
};

const getInvalidTokensFromMulticastResponse = (tokens, response) => {
    if (
        !Array.isArray(tokens) ||
        !tokens.length ||
        !response ||
        !Array.isArray(response.responses)
    ) {
        return [];
    }

    const invalidTokens = response.responses.reduce((acc, sendResponse, index) => {
        if (sendResponse?.success) {
            return acc;
        }
        const errorCode = sendResponse?.error?.code;
        if (!PERMANENT_FCM_TOKEN_ERRORS.has(errorCode)) {
            return acc;
        }

        const token = tokens[index];
        if (typeof token === "string" && token.length > 0) {
            acc.push(token);
        }
        return acc;
    }, []);

    return [...new Set(invalidTokens)];
};

const deleteNotificationTokensForUser = async ({
    userId,
    tokens,
    logPrefix,
}) => {
    const tokenRefs = [...new Set(tokens)]
        .filter((token) => typeof token === "string" && token.length > 0)
        .map((token) => db.doc(`users/${userId}/notificationTokens/${token}`));

    if (!tokenRefs.length) {
        return 0;
    }

    return deleteDocumentRefs(tokenRefs, `${logPrefix}:invalidTokens`);
};

const normalizeActivityString = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
};

const persistActivityForUser = async ({
    userId,
    title,
    body,
    data,
    logPrefix,
    level = "info",
}) => {
    const normalizedUserId = normalizeActivityString(userId);
    const normalizedTitle = normalizeActivityString(title);
    const normalizedBody = typeof body === "string" ? body.trim() : "";

    if (!normalizedUserId || !normalizedTitle) {
        return null;
    }

    await db.collection(`users/${normalizedUserId}/activity`).add({
        userId: normalizedUserId,
        title: normalizedTitle,
        body: normalizedBody,
        type: normalizeActivityString(data?.type) || "system_info",
        link: normalizeActivityString(data?.link),
        postId: normalizeActivityString(data?.postId),
        spotId: normalizeActivityString(data?.spotId),
        eventId: normalizeActivityString(data?.eventId),
        reviewId: normalizeActivityString(data?.reviewId),
        commentId: normalizeActivityString(data?.commentId),
        likeId: normalizeActivityString(data?.likeId),
        participantId: normalizeActivityString(data?.participantId),
        level: level === "success" || level === "error" ? level : "info",
        isRead: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
        readAt: null,
    });
    console.log(`[${logPrefix}] Activity persisted for`, normalizedUserId);
    return null;
};

const sendNotificationToUser = async ({
    ownerId,
    title,
    body,
    data,
    logPrefix,
    activityLevel,
}) => {
    try {
        await persistActivityForUser({
            userId: ownerId,
            title,
            body,
            data,
            logPrefix,
            level: activityLevel,
        });
    } catch (activityError) {
        console.error(`[${logPrefix}] Failed to persist activity`, activityError);
    }

    const tokens = await getNotificationTokensForUser(ownerId);
    if (!tokens.length) {
        console.log(`[${logPrefix}] No notification tokens for owner`, ownerId);
        return;
    }

    const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {title, body},
        data,
    });
    console.log(
        `[${logPrefix}] Notification sent`,
        response.successCount,
        "success,",
        response.failureCount,
        "failed",
    );

    try {
        const invalidTokens = getInvalidTokensFromMulticastResponse(tokens, response);
        if (!invalidTokens.length) {
            return;
        }

        const deletedCount = await deleteNotificationTokensForUser({
            userId: ownerId,
            tokens: invalidTokens,
            logPrefix,
        });
        console.log(
            `[${logPrefix}] Removed`,
            deletedCount,
            "invalid notification tokens",
        );
    } catch (cleanupError) {
        console.error(`[${logPrefix}] Failed to remove invalid tokens`, cleanupError);
    }
};

const resolvePostOwner = async (postId) => {
    const normalizedPostId = String(postId || "").trim();
    if (!normalizedPostId) {
        return null;
    }

    const postSnap = await db.doc(`posts/${normalizedPostId}`).get();
    if (postSnap.exists) {
        const post = postSnap.data() || {};
        return {
            ownerId: post.createdBy || null,
            postType: typeof post.type === "string" ? post.type : null,
        };
    }

    const spotIdMatch = normalizedPostId.match(/^spot_(.+)$/);
    if (!spotIdMatch || !spotIdMatch[1]) {
        return null;
    }

    const spotId = spotIdMatch[1];
    const spotSnap = await db.doc(`spots/${spotId}`).get();
    if (!spotSnap.exists) {
        return null;
    }

    const spot = spotSnap.data() || {};
    return {
        ownerId: spot.createdBy || null,
        postType: "spot",
    };
};

exports.onReviewCreated = functions.firestore
    .document("reviews/{reviewId}")
    .onCreate(async (snap, context) => {
        const review = snap.data();
        if (!review || !review.spotId || !review.userId) {
            console.log("[onReviewCreated] Missing review data, skipping");
            return;
        }

        try {
            // 1) Obtener el spot asociado
            const spotSnap = await db.doc(`spots/${review.spotId}`).get();
            if (!spotSnap.exists) {
                console.log("[onReviewCreated] Spot does not exist, skipping");
                return;
            }

            const spot = spotSnap.data();
            const ownerId = spot.createdBy;
            if (!ownerId) {
                console.log("[onReviewCreated] Spot has no createdBy, skipping");
                return;
            }

            // No notificar si el que comenta es el mismo creador del spot
            if (ownerId === review.userId) {
                console.log("[onReviewCreated] Review author is spot owner, skipping");
                return;
            }

            // 2) Construir el mensaje de notificación
            const title = "Nuevo comentario en tu spot";
            const body =
                review.type === "rating"
                    ? "Han dejado una valoración en uno de tus spots."
                    : "Han dejado un comentario en uno de tus spots.";

            // 3) Enviar la notificación vía FCM
            await sendNotificationToUser({
                ownerId,
                title,
                body,
                data: {
                    spotId: String(review.spotId),
                    reviewId: String(snap.id),
                    type: "spot_review",
                },
                logPrefix: "onReviewCreated",
            });
        } catch (error) {
            console.error("[onReviewCreated] Error handling new review", error);
        }
    });

exports.onPostCommentCreated = functions.firestore
    .document("postComments/{commentId}")
    .onCreate(async (snap) => {
        const comment = snap.data();
        if (!comment || !comment.postId || !comment.userId) {
            console.log("[onPostCommentCreated] Missing post comment data, skipping");
            return;
        }

        try {
            const postOwner = await resolvePostOwner(comment.postId);
            if (!postOwner || !postOwner.ownerId) {
                console.log("[onPostCommentCreated] Owner not found for post", comment.postId);
                return;
            }

            const ownerId = postOwner.ownerId;
            if (ownerId === comment.userId) {
                console.log("[onPostCommentCreated] Author is owner, skipping");
                return;
            }

            await sendNotificationToUser({
                ownerId,
                title: "Nuevo comentario en tu publicación",
                body: "Han comentado una de tus publicaciones.",
                data: {
                    postId: String(comment.postId),
                    commentId: String(snap.id),
                    type: "post_comment",
                    link: buildFeedPostDeepLink(String(comment.postId)),
                },
                logPrefix: "onPostCommentCreated",
            });
        } catch (error) {
            console.error("[onPostCommentCreated] Error handling new post comment", error);
        }
    });

exports.onLikeCreated = functions.firestore
    .document("likes/{likeId}")
    .onCreate(async (snap) => {
        const like = snap.data();
        if (!like || !like.postId || !like.userId) {
            console.log("[onLikeCreated] Missing like data, skipping");
            return;
        }

        try {
            const postOwner = await resolvePostOwner(like.postId);
            if (!postOwner || !postOwner.ownerId) {
                console.log("[onLikeCreated] Owner not found for post", like.postId);
                return;
            }

            const ownerId = postOwner.ownerId;
            if (ownerId === like.userId) {
                console.log("[onLikeCreated] Liker is owner, skipping");
                return;
            }

            await sendNotificationToUser({
                ownerId,
                title: "Nuevo like en tu publicación",
                body: "A alguien le ha gustado una de tus publicaciones.",
                data: {
                    postId: String(like.postId),
                    likeId: String(snap.id),
                    type: "post_like",
                    link: buildFeedPostDeepLink(String(like.postId)),
                },
                logPrefix: "onLikeCreated",
            });
        } catch (error) {
            console.error("[onLikeCreated] Error handling new like", error);
        }
    });

exports.onPostDeletedCleanup = functions.firestore
    .document("posts/{postId}")
    .onDelete(async (_snap, context) => {
        const postId = String(context.params.postId || "").trim();
        if (!postId) {
            return null;
        }

        try {
            await Promise.all([
                deleteCollectionDocsWhere({
                    collectionPath: "postComments",
                    field: "postId",
                    value: postId,
                    logPrefix: `onPostDeletedCleanup:${postId}:postComments`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "likes",
                    field: "postId",
                    value: postId,
                    logPrefix: `onPostDeletedCleanup:${postId}:likes`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reports",
                    field: "targetId",
                    value: postId,
                    predicate: (report) => report.targetType === "post",
                    logPrefix: `onPostDeletedCleanup:${postId}:targetReports`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reports",
                    field: "contextPostId",
                    value: postId,
                    logPrefix: `onPostDeletedCleanup:${postId}:contextReports`,
                }),
            ]);
        } catch (error) {
            console.error("[onPostDeletedCleanup] Cascade delete failed", {postId, error});
        }
        return null;
    });

exports.onPostCommentDeletedCleanup = functions.firestore
    .document("postComments/{commentId}")
    .onDelete(async (_snap, context) => {
        const commentId = String(context.params.commentId || "").trim();
        if (!commentId) {
            return null;
        }

        try {
            await deleteCollectionDocsWhere({
                collectionPath: "reports",
                field: "targetId",
                value: commentId,
                predicate: (report) => report.targetType === "postComment",
                logPrefix: `onPostCommentDeletedCleanup:${commentId}:reports`,
            });
        } catch (error) {
            console.error("[onPostCommentDeletedCleanup] Cascade delete failed", {
                commentId,
                error,
            });
        }
        return null;
    });

exports.onReviewDeletedCleanup = functions.firestore
    .document("reviews/{reviewId}")
    .onDelete(async (_snap, context) => {
        const reviewId = String(context.params.reviewId || "").trim();
        if (!reviewId) {
            return null;
        }

        try {
            await deleteCollectionDocsWhere({
                collectionPath: "reports",
                field: "targetId",
                value: reviewId,
                predicate: (report) => report.targetType === "review",
                logPrefix: `onReviewDeletedCleanup:${reviewId}:reports`,
            });
        } catch (error) {
            console.error("[onReviewDeletedCleanup] Cascade delete failed", {reviewId, error});
        }
        return null;
    });

exports.onSpotDeletedCleanup = functions.firestore
    .document("spots/{spotId}")
    .onDelete(async (_snap, context) => {
        const spotId = String(context.params.spotId || "").trim();
        if (!spotId) {
            return null;
        }

        const mirrorPostId = `spot_${spotId}`;

        try {
            await Promise.all([
                deleteCollectionDocsWhere({
                    collectionPath: "posts",
                    field: "spotId",
                    value: spotId,
                    logPrefix: `onSpotDeletedCleanup:${spotId}:postsBySpotId`,
                }),
                deleteDocIfExists(
                    `posts/${mirrorPostId}`,
                    `onSpotDeletedCleanup:${spotId}:mirrorPost`,
                ),
                deleteCollectionDocsWhere({
                    collectionPath: "reviews",
                    field: "spotId",
                    value: spotId,
                    logPrefix: `onSpotDeletedCleanup:${spotId}:reviews`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reports",
                    field: "targetId",
                    value: spotId,
                    predicate: (report) => report.targetType === "spot",
                    logPrefix: `onSpotDeletedCleanup:${spotId}:targetReports`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reports",
                    field: "contextSpotId",
                    value: spotId,
                    logPrefix: `onSpotDeletedCleanup:${spotId}:contextReports`,
                }),
            ]);
        } catch (error) {
            console.error("[onSpotDeletedCleanup] Cascade delete failed", {spotId, error});
        }
        return null;
    });

exports.onEventDeletedCleanup = functions.firestore
    .document("events/{eventId}")
    .onDelete(async (snap, context) => {
        const eventId = String(context.params.eventId || "").trim();
        if (!eventId) {
            return null;
        }

        const event = snap.data() || {};
        const mirrorPostId = typeof event.mirrorPostId === "string" && event.mirrorPostId.trim() ?
            event.mirrorPostId.trim() :
            `event_${eventId}`;

        try {
            await Promise.all([
                deleteAllDocsInCollection(
                    `events/${eventId}/participants`,
                    `onEventDeletedCleanup:${eventId}:participants`,
                ),
                deleteCollectionDocsWhere({
                    collectionPath: "posts",
                    field: "eventId",
                    value: eventId,
                    predicate: (post) => post.type === "event",
                    logPrefix: `onEventDeletedCleanup:${eventId}:postsByEventId`,
                }),
                deleteDocIfExists(
                    `posts/${mirrorPostId}`,
                    `onEventDeletedCleanup:${eventId}:mirrorPost`,
                ),
            ]);
        } catch (error) {
            console.error("[onEventDeletedCleanup] Cascade delete failed", {eventId, error});
        }
        return null;
    });

exports.onUserProfileDeletedCleanup = functions.firestore
    .document("users/{userId}")
    .onDelete(async (_snap, context) => {
        const userId = String(context.params.userId || "").trim();
        if (!userId) {
            return null;
        }

        try {
            await Promise.all([
                deleteAllDocsInCollection(
                    `users/${userId}/notificationTokens`,
                    `onUserProfileDeletedCleanup:${userId}:tokens`,
                ),
                deleteAllDocsInCollection(
                    `users/${userId}/activity`,
                    `onUserProfileDeletedCleanup:${userId}:activity`,
                ),
                deleteCollectionDocsWhere({
                    collectionPath: "spots",
                    field: "createdBy",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:spots`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "events",
                    field: "createdBy",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:events`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "posts",
                    field: "createdBy",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:posts`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reviews",
                    field: "userId",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:reviews`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "postComments",
                    field: "userId",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:postComments`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "likes",
                    field: "userId",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:likes`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reports",
                    field: "createdBy",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:reportsByAuthor`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "reports",
                    field: "targetId",
                    value: userId,
                    predicate: (report) => report.targetType === "user",
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:reportsByTarget`,
                }),
                deleteCollectionDocsWhere({
                    collectionPath: "affiliateClicks",
                    field: "userId",
                    value: userId,
                    logPrefix: `onUserProfileDeletedCleanup:${userId}:affiliateClicks`,
                }),
            ]);
        } catch (error) {
            console.error("[onUserProfileDeletedCleanup] Cascade delete failed", {userId, error});
        }
        return null;
    });

exports.onAuthUserDeletedCleanup = functions.auth.user()
    .onDelete(async (userRecord) => {
        const userId = String(userRecord.uid || "").trim();
        if (!userId) {
            return null;
        }

        try {
            await deleteDocIfExists(
                `users/${userId}`,
                `onAuthUserDeletedCleanup:${userId}:profile`,
            );
        } catch (error) {
            console.error("[onAuthUserDeletedCleanup] Failed to delete user profile", {
                userId,
                error,
            });
        }
        return null;
    });

exports.cleanupExpiredEvents = functions.pubsub
    .schedule("every 60 minutes")
    .timeZone("Etc/UTC")
    .onRun(async () => {
        const now = Date.now();
        try {
            const snapshot = await db
                .collection("events")
                .where("cleanupAfterMs", "<=", now)
                .limit(BATCH_DELETE_LIMIT)
                .get();

            if (snapshot.empty) {
                console.log("[cleanupExpiredEvents] No expired events to delete");
                return null;
            }

            await deleteDocumentRefs(
                snapshot.docs.map((docSnapshot) => docSnapshot.ref),
                "cleanupExpiredEvents:events",
            );
        } catch (error) {
            console.error("[cleanupExpiredEvents] Failed to remove expired events", error);
        }
        return null;
    });

exports.onEventParticipantWrite = functions.firestore
    .document("events/{eventId}/participants/{participantId}")
    .onWrite(async (change, context) => {
        const eventId = String(context.params.eventId || "").trim();
        const participantId = String(context.params.participantId || "").trim();
        if (!eventId || !participantId || !change.after.exists) {
            return null;
        }

        const before = change.before.exists ? change.before.data() || {} : null;
        const after = change.after.data() || {};
        const nextStatus = String(after.status || "").trim();
        const previousStatus = String(before?.status || "").trim();
        if (!nextStatus || nextStatus === previousStatus) {
            return null;
        }

        try {
            const [eventSnap, participantProfileSnap] = await Promise.all([
                db.doc(`events/${eventId}`).get(),
                db.doc(`users/${participantId}`).get(),
            ]);

            if (!eventSnap.exists) {
                return null;
            }

            const event = eventSnap.data() || {};
            const eventOwnerId = typeof event.createdBy === "string" ? event.createdBy : "";
            const eventTitle = typeof event.title === "string" && event.title.trim() ?
                event.title.trim() :
                "Quedada";
            const participantName = participantProfileSnap.exists &&
                typeof participantProfileSnap.data()?.displayName === "string" &&
                participantProfileSnap.data().displayName.trim() ?
                participantProfileSnap.data().displayName.trim() :
                "Un piloto";

            if (nextStatus === "invited" && participantId !== eventOwnerId) {
                const isApproval = previousStatus === "requested";
                await sendNotificationToUser({
                    ownerId: participantId,
                    title: isApproval ? "Solicitud aceptada" : "Nueva invitacion a una quedada",
                    body: isApproval ?
                        `Ya puedes confirmar tu asistencia a "${eventTitle}".` :
                        `Te han invitado a "${eventTitle}".`,
                    data: {
                        eventId,
                        type: isApproval ? "event_approved" : "event_invite",
                        link: buildEventDeepLink(eventId),
                    },
                    logPrefix: "onEventParticipantWrite.invited",
                });
                return null;
            }

            if (nextStatus === "requested" && participantId !== eventOwnerId && eventOwnerId) {
                await sendNotificationToUser({
                    ownerId: eventOwnerId,
                    title: "Nueva solicitud para tu quedada",
                    body: `${participantName} quiere unirse a "${eventTitle}".`,
                    data: {
                        eventId,
                        participantId,
                        type: "event_request",
                        link: buildEventDeepLink(eventId),
                    },
                    logPrefix: "onEventParticipantWrite.requested",
                });
                return null;
            }

            if (nextStatus === "going" && participantId !== eventOwnerId && eventOwnerId) {
                await sendNotificationToUser({
                    ownerId: eventOwnerId,
                    title: "Nueva asistencia confirmada",
                    body: `${participantName} asistira a "${eventTitle}".`,
                    data: {
                        eventId,
                        participantId,
                        type: "event_attending",
                        link: buildEventDeepLink(eventId),
                    },
                    logPrefix: "onEventParticipantWrite.going",
                });
                return null;
            }

            if (nextStatus === "declined" && participantId !== eventOwnerId && eventOwnerId) {
                await sendNotificationToUser({
                    ownerId: eventOwnerId,
                    title: "Asistencia rechazada",
                    body: `${participantName} no asistira a "${eventTitle}".`,
                    data: {
                        eventId,
                        participantId,
                        type: "event_declined",
                        link: buildEventDeepLink(eventId),
                    },
                    logPrefix: "onEventParticipantWrite.declined",
                });
            }
        } catch (error) {
            console.error("[onEventParticipantWrite] Failed handling participant change", {
                eventId,
                participantId,
                error,
            });
        }
        return null;
    });

const getRatingValue = (review) => {
    if (!review) {
        return null;
    }
    const rating = review.rating;
    if (typeof rating !== "number" || rating <= 0) {
        return null;
    }
    return rating;
};

exports.onReviewWrite = functions.firestore
    .document("reviews/{reviewId}")
    .onWrite(async (change) => {
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;

        if (!before && !after) {
            return null;
        }

        const beforeSpotId = before?.spotId;
        const afterSpotId = after?.spotId;
        if (beforeSpotId && afterSpotId && beforeSpotId !== afterSpotId) {
            console.warn("[onReviewWrite] spotId changed; skipping aggregate update.", {
                beforeSpotId,
                afterSpotId,
            });
            return null;
        }

        const spotId = afterSpotId || beforeSpotId;
        if (!spotId) {
            return null;
        }

        const reviewCountDelta = !before && after ? 1 : before && !after ? -1 : 0;

        const beforeRating = getRatingValue(before);
        const afterRating = getRatingValue(after);

        let ratingCountDelta = 0;
        if (beforeRating == null && afterRating != null) {
            ratingCountDelta = 1;
        } else if (beforeRating != null && afterRating == null) {
            ratingCountDelta = -1;
        }

        const ratingTotalDelta = (afterRating || 0) - (beforeRating || 0);

        if (reviewCountDelta === 0 && ratingCountDelta === 0 && ratingTotalDelta === 0) {
            return null;
        }

        const spotRef = db.doc(`spots/${spotId}`);

        await db.runTransaction(async (transaction) => {
            const spotSnap = await transaction.get(spotRef);
            if (!spotSnap.exists) {
                return;
            }

            const spot = spotSnap.data() || {};
            const existingReviewCount = Number(spot.reviewCount || 0);
            const existingRatingCount = Number(
                spot.ratingCount ?? spot.reviewCount ?? 0,
            );
            const existingAverageRating = Number(spot.averageRating || 0);
            const existingRatingTotal = existingAverageRating * existingRatingCount;

            const nextReviewCount = Math.max(0, existingReviewCount + reviewCountDelta);
            const nextRatingCount = Math.max(0, existingRatingCount + ratingCountDelta);
            const nextAverageRating = nextRatingCount > 0
                ? (existingRatingTotal + ratingTotalDelta) / nextRatingCount
                : 0;

            transaction.update(spotRef, {
                reviewCount: nextReviewCount,
                ratingCount: nextRatingCount,
                averageRating: nextAverageRating,
            });
        });

        return null;
    });
