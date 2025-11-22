const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

// Opcional: limitar concurrencia global de las funciones para controlar costes
functions.logger.log("[Init] Functions config loaded");

admin.initializeApp();
const db = admin.firestore();

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

      // 2) Obtener tokens de notificación del creador
      const tokensSnap = await db
        .collection(`users/${ownerId}/notificationTokens`)
        .get();

      if (tokensSnap.empty) {
        console.log("[onReviewCreated] No notification tokens for owner", ownerId);
        return;
      }

      const tokens = tokensSnap.docs.map((doc) => doc.id);
      console.log(
        "[onReviewCreated] Sending notification to owner",
        ownerId,
        "tokens:",
        tokens.length,
      );

      // 3) Construir el mensaje de notificación
      const title = "Nuevo comentario en tu spot";
      const body =
        review.type === "rating"
          ? "Han dejado una valoración en uno de tus spots."
          : "Han dejado un comentario en uno de tus spots.";

      const message = {
        tokens,
        notification: {title, body},
        data: {
          spotId: review.spotId,
          reviewId: snap.id,
        },
      };

      // 4) Enviar la notificación vía FCM
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(
        "[onReviewCreated] Notification sent",
        response.successCount,
        "success,",
        response.failureCount,
        "failed",
      );
    } catch (error) {
      console.error("[onReviewCreated] Error handling new review", error);
    }
  });
