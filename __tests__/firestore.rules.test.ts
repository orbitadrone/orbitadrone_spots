/** @jest-environment node */
import {readFileSync} from 'fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  GeoPoint,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const RULES_PATH = 'firestore.rules';
const PROJECT_ID = `orbitadrone-spots-rules-${Date.now()}`;
const shouldRunRulesTests = process.env.RUN_FIRESTORE_RULES_TESTS === '1';
const describeRules = shouldRunRulesTests ? describe : describe.skip;

describeRules('Firestore security rules', () => {
  const rules = readFileSync(RULES_PATH, 'utf8');
  let testEnv: Awaited<ReturnType<typeof initializeTestEnvironment>>;

  beforeAll(async () => {
    if (!shouldRunRulesTests) {
      return;
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (!shouldRunRulesTests) {
      return;
    }

    await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (!shouldRunRulesTests) {
      return;
    }

    await testEnv.clearFirestore();
  });

  const seedSpot = async (spotId = 'spot1') => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'spots', spotId), {
        name: 'Spot Test',
        description: 'Spot seed',
        coordinates: new GeoPoint(41.3851, 2.1734),
        createdBy: 'alice',
        createdAt: new Date(),
        averageRating: 0,
        reviewCount: 0,
        ratingCount: 0,
      });
    });
  };

  const seedAdminUser = async (uid = 'adminUser') => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'adminUsers', uid), {
        createdAt: new Date(),
      });
    });
  };

  const seedEvent = async ({
    eventId = 'event1',
    createdBy = 'alice',
    isPublic = true,
    publicJoinMode,
  }: {
    eventId?: string;
    createdBy?: string;
    isPublic?: boolean;
    publicJoinMode?: 'approval_required' | 'open';
  } = {}) => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'events', eventId), {
        title: 'Quedada Sunset',
        description: 'Vuelo compartido',
        createdBy,
        createdAt: new Date(),
        createdAtMs: Date.now(),
        startsAt: new Date(Date.now() + 3600000),
        startsAtMs: Date.now() + 3600000,
        cleanupAfterMs: Date.now() + 24 * 3600000,
        isPublic,
        ...(publicJoinMode ? {publicJoinMode} : {}),
        coordinates: new GeoPoint(41.3851, 2.1734),
        locationLabel: 'Montserrat',
        locationAddress: 'Barcelona',
        mirrorPostId: `event_${eventId}`,
      });
    });
  };

  const seedActivity = async ({
    userId = 'alice',
    activityId = 'activity1',
  }: {
    userId?: string;
    activityId?: string;
  } = {}) => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', userId), {
        displayName: userId,
      });
      await setDoc(doc(adminDb, 'users', userId, 'activity', activityId), {
        userId,
        title: 'Nuevo like en tu publicación',
        body: 'A alguien le ha gustado una de tus publicaciones.',
        type: 'post_like',
        postId: 'post_1',
        level: 'info',
        isRead: false,
        createdAt: new Date('2026-03-13T11:00:00.000Z'),
        createdAtMs: Date.parse('2026-03-13T11:00:00.000Z'),
        readAt: null,
      });
    });
  };

  it('permite lectura pública de spots', async () => {
    await seedSpot();
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(unauthDb, 'spots', 'spot1')));
  });

  it('bloquea lectura pública de perfiles de usuarios', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'users', 'alice'), {displayName: 'Alice'});
    });
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'users', 'alice')));
  });

  it('permite al propietario leer su actividad', async () => {
    await seedActivity();
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(aliceDb, 'users', 'alice', 'activity', 'activity1')));
  });

  it('bloquea leer actividad ajena', async () => {
    await seedActivity();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bobDb, 'users', 'alice', 'activity', 'activity1')));
  });

  it('permite marcar la actividad propia como leida', async () => {
    await seedActivity();
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(aliceDb, 'users', 'alice', 'activity', 'activity1'), {
        isRead: true,
        readAt: new Date('2026-03-13T11:05:00.000Z'),
      }),
    );
  });

  it('bloquea crear actividad desde cliente', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(aliceDb, 'users', 'alice', 'activity', 'activity_new'), {
        userId: 'alice',
        title: 'Creación manual',
        body: 'No permitida',
        type: 'system_info',
        level: 'info',
        isRead: false,
        createdAt: new Date(),
        createdAtMs: Date.now(),
        readAt: null,
      }),
    );
  });

  it('bloquea modificar campos inmutables de actividad', async () => {
    await seedActivity();
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(aliceDb, 'users', 'alice', 'activity', 'activity1'), {
        title: 'Hack',
      }),
    );
  });

  it('permite crear spot con agregados en cero', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'spots', 'spot_create_ok'), {
        name: 'Nuevo',
        description: 'Ok',
        coordinates: new GeoPoint(41.4, 2.1),
        createdBy: 'alice',
        averageRating: 0,
        reviewCount: 0,
        ratingCount: 0,
      }),
    );
  });

  it('rechaza crear spot con agregados distintos de cero', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(aliceDb, 'spots', 'spot_create_bad'), {
        name: 'Nuevo',
        description: 'Bad',
        coordinates: new GeoPoint(41.4, 2.1),
        createdBy: 'alice',
        averageRating: 4.5,
        reviewCount: 10,
        ratingCount: 10,
      }),
    );
  });

  it('rechaza crear spot si createdBy no coincide con el auth uid', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(aliceDb, 'spots', 'spot_create_owner_bad'), {
        name: 'Nuevo',
        description: 'Bad owner',
        coordinates: new GeoPoint(41.4, 2.1),
        createdBy: 'bob',
        averageRating: 0,
        reviewCount: 0,
        ratingCount: 0,
      }),
    );
  });

  it('impide modificar agregados de spots desde cliente', async () => {
    await seedSpot();
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(aliceDb, 'spots', 'spot1'), {averageRating: 4.9}),
    );
    await assertSucceeds(
      updateDoc(doc(aliceDb, 'spots', 'spot1'), {description: 'Actualizado'}),
    );
  });

  it('impide actualizar spots ajenos', async () => {
    await seedSpot();
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(
      updateDoc(doc(bobDb, 'spots', 'spot1'), {description: 'Hack'}),
    );
  });

  it('permite a admin ocultar spots y bloquea su lectura pública', async () => {
    await seedSpot('spot_hidden');
    await seedAdminUser('admin1');

    const adminDb = testEnv.authenticatedContext('admin1').firestore();
    await assertSucceeds(
      updateDoc(doc(adminDb, 'spots', 'spot_hidden'), {
        isHidden: true,
      }),
    );

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'spots', 'spot_hidden')));
  });

  it('permite a admin moderar comentarios', async () => {
    await seedAdminUser('admin2');
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'reviews', 'comment_spot5_alice'), {
        spotId: 'spot5',
        userId: 'alice',
        type: 'comment',
        text: 'Comentario visible',
      }),
    );

    const adminDb = testEnv.authenticatedContext('admin2').firestore();
    await assertSucceeds(
      updateDoc(doc(adminDb, 'reviews', 'comment_spot5_alice'), {
        moderationStatus: 'hidden',
      }),
    );
  });

  it('permite crear rating sin texto y con docId correcto', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'reviews', 'rating_spot1_alice'), {
        spotId: 'spot1',
        userId: 'alice',
        type: 'rating',
        rating: 5,
      }),
    );
  });

  it('rechaza rating con texto o con moderación manipulada', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(aliceDb, 'reviews', 'rating_spot2_alice'), {
        spotId: 'spot2',
        userId: 'alice',
        type: 'rating',
        rating: 4,
        text: 'No permitido',
      }),
    );
    await assertFails(
      setDoc(doc(aliceDb, 'reviews', 'rating_spot3_alice'), {
        spotId: 'spot3',
        userId: 'alice',
        type: 'rating',
        rating: 4,
        moderationStatus: 'rejected',
      }),
    );
  });

  it('permite crear comentario con texto y sin rating', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'reviews', 'comment_spot1_alice'), {
        spotId: 'spot1',
        userId: 'alice',
        type: 'comment',
        text: 'Buen spot',
      }),
    );
  });

  it('rechaza comentario con rating o cambios de moderación', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(aliceDb, 'reviews', 'comment_spot2_alice'), {
        spotId: 'spot2',
        userId: 'alice',
        type: 'comment',
        text: 'Texto',
        rating: 3,
      }),
    );

    await setDoc(doc(aliceDb, 'reviews', 'comment_spot3_alice'), {
      spotId: 'spot3',
      userId: 'alice',
      type: 'comment',
      text: 'Comentario',
    });

    await assertFails(
      updateDoc(doc(aliceDb, 'reviews', 'comment_spot3_alice'), {
        moderationStatus: 'rejected',
      }),
    );
  });

  it('permite crear un like propio con docId valido', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'likes', 'drone_post123_alice'), {
        postId: 'post123',
        postType: 'drone',
        userId: 'alice',
        createdAt: new Date(),
      }),
    );
  });

  it('rechaza crear un like con docId invalido', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      setDoc(doc(aliceDb, 'likes', 'post123_alice'), {
        postId: 'post123',
        postType: 'drone',
        userId: 'alice',
        createdAt: new Date(),
      }),
    );
  });

  it('permite crear un evento valido al propietario autenticado', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'events', 'event_create_ok'), {
        title: 'Vuelo al amanecer',
        description: 'Nos vemos temprano',
        createdBy: 'alice',
        startsAt: new Date(Date.now() + 2 * 3600000),
        startsAtMs: Date.now() + 2 * 3600000,
        cleanupAfterMs: Date.now() + 26 * 3600000,
        isPublic: true,
        publicJoinMode: 'approval_required',
        coordinates: new GeoPoint(41.4, 2.2),
        locationLabel: 'Mirador',
        locationAddress: 'Barcelona',
        mirrorPostId: 'event_event_create_ok',
      }),
    );
  });

  it('permite crear un evento publico con acceso libre', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      setDoc(doc(aliceDb, 'events', 'event_create_open_join'), {
        title: 'Open fly-in',
        description: 'Cualquiera puede sumarse',
        createdBy: 'alice',
        startsAt: new Date(Date.now() + 3 * 3600000),
        startsAtMs: Date.now() + 3 * 3600000,
        cleanupAfterMs: Date.now() + 27 * 3600000,
        isPublic: true,
        publicJoinMode: 'open',
        coordinates: new GeoPoint(41.41, 2.21),
        locationLabel: 'Campo',
        locationAddress: 'Barcelona',
        mirrorPostId: 'event_event_create_open_join',
      }),
    );
  });

  it('bloquea leer evento privado si no eres participante ni creador', async () => {
    await seedEvent({eventId: 'event_private', createdBy: 'alice', isPublic: false});
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bobDb, 'events', 'event_private')));

    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'events', 'event_private', 'participants', 'bob'), {
        userId: 'bob',
        status: 'invited',
        invitedBy: 'alice',
        createdAt: new Date(),
      });
    });

    await assertSucceeds(getDoc(doc(bobDb, 'events', 'event_private')));
  });

  it('permite consultar los eventos creados por el propietario autenticado', async () => {
    await seedEvent({eventId: 'event_private_mine', createdBy: 'alice', isPublic: false});
    await seedEvent({eventId: 'event_public_mine', createdBy: 'alice', isPublic: true});

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    const ownEventsQuery = query(
      collection(aliceDb, 'events'),
      where('createdBy', '==', 'alice'),
    );

    const snapshot = await assertSucceeds(getDocs(ownEventsQuery));
    expect(snapshot.docs.map(docSnapshot => docSnapshot.id).sort()).toEqual([
      'event_private_mine',
      'event_public_mine',
    ]);
  });

  it('permite solicitar acceso a evento publico creando participante requested', async () => {
    await seedEvent({eventId: 'event_public', createdBy: 'alice', isPublic: true});
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(
      setDoc(doc(bobDb, 'events', 'event_public', 'participants', 'bob'), {
        userId: 'bob',
        status: 'requested',
        invitedBy: null,
        createdAt: new Date(),
      }),
    );
  });

  it('permite unirse directamente a un evento publico abierto creando participante going', async () => {
    await seedEvent({
      eventId: 'event_public_open_join',
      createdBy: 'alice',
      isPublic: true,
      publicJoinMode: 'open',
    });
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(
      setDoc(doc(bobDb, 'events', 'event_public_open_join', 'participants', 'bob'), {
        userId: 'bob',
        status: 'going',
        invitedBy: 'alice',
        createdAt: new Date(),
        respondedAt: new Date(),
      }),
    );
  });

  it('bloquea auto-confirmarse como going en un evento publico con lista cerrada', async () => {
    await seedEvent({
      eventId: 'event_public_closed_join',
      createdBy: 'alice',
      isPublic: true,
      publicJoinMode: 'approval_required',
    });
    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(
      setDoc(doc(bobDb, 'events', 'event_public_closed_join', 'participants', 'bob'), {
        userId: 'bob',
        status: 'going',
        invitedBy: 'alice',
        createdAt: new Date(),
        respondedAt: new Date(),
      }),
    );
  });

  it('permite al propietario aprobar una solicitud pasando de requested a invited', async () => {
    await seedEvent({eventId: 'event_public_owner_approve', createdBy: 'alice', isPublic: true});
    const createdAt = new Date('2026-03-13T10:00:00.000Z');

    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'events', 'event_public_owner_approve', 'participants', 'bob'), {
        userId: 'bob',
        status: 'requested',
        invitedBy: null,
        createdAt,
        respondedAt: null,
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(aliceDb, 'events', 'event_public_owner_approve', 'participants', 'bob'), {
        status: 'invited',
        invitedBy: 'alice',
        createdAt,
      }),
    );
  });

  it('bloquea que el propietario confirme la asistencia ajena pasando a going', async () => {
    await seedEvent({eventId: 'event_public_owner_cannot_force', createdBy: 'alice', isPublic: true});
    const createdAt = new Date('2026-03-13T10:05:00.000Z');

    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(
        doc(adminDb, 'events', 'event_public_owner_cannot_force', 'participants', 'bob'),
        {
          userId: 'bob',
          status: 'requested',
          invitedBy: null,
          createdAt,
          respondedAt: null,
        },
      );
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertFails(
      updateDoc(doc(aliceDb, 'events', 'event_public_owner_cannot_force', 'participants', 'bob'), {
        status: 'going',
        invitedBy: null,
        createdAt,
      }),
    );
  });

  it('permite al propietario sacar a un participante confirmado del evento', async () => {
    await seedEvent({
      eventId: 'event_public_owner_remove_going',
      createdBy: 'alice',
      isPublic: true,
      publicJoinMode: 'open',
    });
    const createdAt = new Date('2026-03-13T10:12:00.000Z');

    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(
        doc(adminDb, 'events', 'event_public_owner_remove_going', 'participants', 'bob'),
        {
          userId: 'bob',
          status: 'going',
          invitedBy: 'alice',
          createdAt,
          respondedAt: new Date('2026-03-13T10:13:00.000Z'),
        },
      );
    });

    const aliceDb = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(
      updateDoc(doc(aliceDb, 'events', 'event_public_owner_remove_going', 'participants', 'bob'), {
        status: 'declined',
        invitedBy: 'alice',
        createdAt,
      }),
    );
  });

  it('bloquea que un usuario requested se auto-confirme como going sin aprobacion', async () => {
    await seedEvent({eventId: 'event_public_self_confirm_blocked', createdBy: 'alice', isPublic: true});
    const createdAt = new Date('2026-03-13T10:10:00.000Z');

    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(
        doc(adminDb, 'events', 'event_public_self_confirm_blocked', 'participants', 'bob'),
        {
          userId: 'bob',
          status: 'requested',
          invitedBy: null,
          createdAt,
          respondedAt: null,
        },
      );
    });

    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(
      updateDoc(doc(bobDb, 'events', 'event_public_self_confirm_blocked', 'participants', 'bob'), {
        status: 'going',
        invitedBy: null,
        createdAt,
      }),
    );
  });

  it('bloquea que un participante rechazado se reactive por su cuenta', async () => {
    await seedEvent({
      eventId: 'event_public_removed_cannot_restore',
      createdBy: 'alice',
      isPublic: true,
      publicJoinMode: 'open',
    });
    const createdAt = new Date('2026-03-13T10:14:00.000Z');

    await testEnv.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      await setDoc(
        doc(adminDb, 'events', 'event_public_removed_cannot_restore', 'participants', 'bob'),
        {
          userId: 'bob',
          status: 'declined',
          invitedBy: 'alice',
          createdAt,
          respondedAt: new Date('2026-03-13T10:15:00.000Z'),
        },
      );
    });

    const bobDb = testEnv.authenticatedContext('bob').firestore();
    await assertFails(
      updateDoc(
        doc(bobDb, 'events', 'event_public_removed_cannot_restore', 'participants', 'bob'),
        {
          status: 'going',
          invitedBy: 'alice',
          createdAt,
        },
      ),
    );
  });
});
