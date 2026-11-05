import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const PROJECT_ID = 'orbitadrone-84049';
const FIRESTORE_BASE_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const IDENTITY_BASE_URL =
  `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const readFirebaseCliSession = () => {
  const configPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const accessToken = config?.tokens?.access_token;
  const expiresAt = Number(config?.tokens?.expires_at || 0);

  if (!accessToken) {
    throw new Error('No se encontro access token en la sesion local de Firebase CLI');
  }

  if (expiresAt <= Date.now() + 60_000) {
    throw new Error(
      'El access token local de Firebase CLI esta expirado o a punto de expirar. Ejecuta un comando de firebase para refrescarlo y vuelve a lanzar la prueba.',
    );
  }

  return {accessToken};
};

const authorizedFetch = async (accessToken, url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const firestoreValue = value => {
  if (value === null) {
    return {nullValue: null};
  }

  if (typeof value === 'string') {
    return {stringValue: value};
  }

  if (typeof value === 'boolean') {
    return {booleanValue: value};
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return {integerValue: String(value)};
    }
    return {doubleValue: value};
  }

  if (value instanceof Date) {
    return {timestampValue: value.toISOString()};
  }

  if (Array.isArray(value)) {
    return {arrayValue: {values: value.map(firestoreValue)}};
  }

  if (typeof value === 'object' && value && 'latitude' in value && 'longitude' in value) {
    return {
      geoPointValue: {
        latitude: value.latitude,
        longitude: value.longitude,
      },
    };
  }

  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, nestedValue]) => [key, firestoreValue(nestedValue)]),
        ),
      },
    };
  }

  throw new Error(`Tipo Firestore no soportado: ${typeof value}`);
};

const patchDocument = async (accessToken, docPath, fields) => {
  await authorizedFetch(accessToken, `${FIRESTORE_BASE_URL}/${docPath}`, {
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]),
      ),
    }),
    method: 'PATCH',
  });
};

const getDocument = async (accessToken, docPath) => {
  const response = await fetch(`${FIRESTORE_BASE_URL}/${docPath}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
  }

  return response.json();
};

const createUser = async (accessToken, {email, password, displayName}) =>
  authorizedFetch(accessToken, `${IDENTITY_BASE_URL}/accounts`, {
    body: JSON.stringify({
      displayName,
      email,
      password,
    }),
    method: 'POST',
  });

const lookupUser = async (accessToken, userId) =>
  authorizedFetch(accessToken, `${IDENTITY_BASE_URL}/accounts:lookup`, {
    body: JSON.stringify({
      localId: [userId],
    }),
    method: 'POST',
  });

const deleteUser = async (accessToken, userId) =>
  authorizedFetch(accessToken, `${IDENTITY_BASE_URL}/accounts:delete`, {
    body: JSON.stringify({
      localId: userId,
    }),
    method: 'POST',
  });

const buildFixtureDocPaths = ({runId, userId}) => ({
  activityDocPath: `users/${userId}/activity/audit_activity_${runId}`,
  affiliateClickDocPath: `affiliateClicks/audit_affiliate_${runId}`,
  eventDocPath: `events/audit_event_${runId}`,
  likeDocPath: `likes/drone_audit_like_target_${runId}_${userId}`,
  notificationTokenDocPath: `users/${userId}/notificationTokens/audit_token_${runId}`,
  postCommentDocPath: `postComments/audit_comment_${runId}`,
  postDocPath: `posts/audit_post_${runId}`,
  reportByAuthorDocPath: `reports/audit_report_author_${runId}`,
  reportByTargetDocPath: `reports/audit_report_target_${runId}`,
  reviewDocPath: `reviews/audit_review_${runId}`,
  spotDocPath: `spots/audit_spot_${runId}`,
  userDocPath: `users/${userId}`,
});

const createFixtures = async (accessToken, {runId, userId}) => {
  const docPaths = buildFixtureDocPaths({runId, userId});
  const now = new Date();

  await Promise.all([
    patchDocument(accessToken, docPaths.userDocPath, {
      auditRunId: runId,
      displayName: `Audit ${runId}`,
    }),
    patchDocument(accessToken, docPaths.notificationTokenDocPath, {
      auditRunId: runId,
      token: `audit_token_${runId}`,
      updatedAt: now,
    }),
    patchDocument(accessToken, docPaths.activityDocPath, {
      auditRunId: runId,
      body: 'Smoke test activity',
      isRead: false,
      title: 'Audit activity',
      userId,
    }),
    patchDocument(accessToken, docPaths.spotDocPath, {
      auditRunId: runId,
      createdBy: userId,
      name: 'Audit spot',
    }),
    patchDocument(accessToken, docPaths.eventDocPath, {
      auditRunId: runId,
      createdBy: userId,
      title: 'Audit event',
    }),
    patchDocument(accessToken, docPaths.postDocPath, {
      auditRunId: runId,
      createdBy: userId,
      type: 'drone',
    }),
    patchDocument(accessToken, docPaths.reviewDocPath, {
      auditRunId: runId,
      spotId: `audit_spot_${runId}`,
      type: 'comment',
      userId,
    }),
    patchDocument(accessToken, docPaths.postCommentDocPath, {
      auditRunId: runId,
      postId: `external_post_${runId}`,
      text: 'Audit comment',
      userId,
    }),
    patchDocument(accessToken, docPaths.likeDocPath, {
      auditRunId: runId,
      postId: `audit_like_target_${runId}`,
      postType: 'drone',
      userId,
    }),
    patchDocument(accessToken, docPaths.reportByAuthorDocPath, {
      auditRunId: runId,
      createdBy: userId,
      reasons: ['audit'],
      targetId: `audit_spot_${runId}`,
      targetType: 'spot',
    }),
    patchDocument(accessToken, docPaths.reportByTargetDocPath, {
      auditRunId: runId,
      createdBy: 'audit-observer',
      reasons: ['audit'],
      targetId: userId,
      targetType: 'user',
    }),
    patchDocument(accessToken, docPaths.affiliateClickDocPath, {
      auditRunId: runId,
      source: 'map',
      storeId: 'audit-store',
      storeName: 'Audit Store',
      userId,
    }),
  ]);

  return docPaths;
};

const readFixtureState = async (accessToken, docPaths) => {
  const results = await Promise.all(
    Object.entries(docPaths).map(async ([key, docPath]) => [key, await getDocument(accessToken, docPath)]),
  );

  return Object.fromEntries(results.map(([key, document]) => [key, document !== null]));
};

const waitForUserDeletion = async (accessToken, userId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastFound = true;

  while (Date.now() < deadline) {
    const response = await lookupUser(accessToken, userId);
    const users = Array.isArray(response?.users) ? response.users : [];
    lastFound = users.length > 0;
    if (!lastFound) {
      return {deleted: true, lastFound};
    }
    await sleep(5000);
  }

  return {deleted: false, lastFound};
};

const waitForCascadeCleanup = async (accessToken, docPaths, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;

  while (Date.now() < deadline) {
    lastState = await readFixtureState(accessToken, docPaths);
    if (Object.values(lastState).every(exists => exists === false)) {
      return {completed: true, lastState};
    }
    await sleep(5000);
  }

  return {completed: false, lastState};
};

const main = async () => {
  const {accessToken} = readFirebaseCliSession();
  const runId = Date.now().toString(36);
  const password = `Orbita!${runId}Aa1`;
  const email = `orbitadrone.smoke.${runId}@example.com`;

  const createdUser = await createUser(accessToken, {
    displayName: `Audit ${runId}`,
    email,
    password,
  });
  const userId = createdUser?.localId;

  if (!userId) {
    throw new Error(`No se pudo crear el usuario de prueba: ${JSON.stringify(createdUser)}`);
  }

  const docPaths = await createFixtures(accessToken, {runId, userId});
  const beforeState = await readFixtureState(accessToken, docPaths);

  if (Object.values(beforeState).some(exists => exists === false)) {
    throw new Error(
      `No se pudieron verificar los fixtures iniciales: ${JSON.stringify(beforeState)}`,
    );
  }

  await deleteUser(accessToken, userId);

  const authDeletion = await waitForUserDeletion(accessToken, userId, 90_000);
  const cascadeCleanup = await waitForCascadeCleanup(accessToken, docPaths, 90_000);

  console.log(
    JSON.stringify(
      {
        authDeletion,
        beforeState,
        cascadeCleanup,
        docPaths,
        email,
        runId,
        userId,
      },
      null,
      2,
    ),
  );

  if (!authDeletion.deleted || !cascadeCleanup.completed) {
    process.exitCode = 1;
  }
};

main().catch(error => {
  console.error('[smokeAccountDeletion] failed', error);
  process.exitCode = 1;
});
