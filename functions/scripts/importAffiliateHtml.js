const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const parseArgs = (argv) => {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.replace(/^--/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      i += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
};

const cleanValue = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const stripTags = (value) =>
  value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const extractAttribute = (tag, attribute) => {
  const regex = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  );
  const match = tag.match(regex);
  return cleanValue(match?.[1] || match?.[2] || match?.[3] || null);
};

const extractImageId = (url) => {
  if (!url) {
    return null;
  }
  const fileMatch = url.match(/\/file\/(\d+)\//i);
  if (fileMatch) {
    return fileMatch[1];
  }
  const filenameMatch = url.match(/\/([^/]+)\.(png|jpe?g|webp|gif)/i);
  if (filenameMatch) {
    return filenameMatch[1];
  }
  return null;
};

const buildDocId = (value, groupId) => {
  const digest = crypto.createHash('sha1').update(value).digest('hex');
  return `${groupId}-${digest.slice(0, 20)}`;
};

const parseOffersFromHtml = (content, titlePrefix) => {
  const offers = [];
  const lines = content.split(/\r?\n/);
  let pendingTitle = null;
  let pendingUrl = null;
  let anchorBuffer = null;
  let offerIndex = 0;

  const pushOffer = ({anchorHtml, fallbackIndex}) => {
    const href = extractAttribute(anchorHtml, 'href');
    const imgTagMatch = anchorHtml.match(/<img\b[^>]*>/i);
    const imgTag = imgTagMatch ? imgTagMatch[0] : null;
    const imageUrl = imgTag ? extractAttribute(imgTag, 'src') : null;
    const altText = imgTag ? extractAttribute(imgTag, 'alt') : null;
    const imgTitle = imgTag ? extractAttribute(imgTag, 'title') : null;
    const textContent = cleanValue(
      stripTags(anchorHtml.replace(/<img\b[^>]*>/gi, '')),
    );
    const imageId = extractImageId(imageUrl);
    const fallbackTitle = titlePrefix
      ? `${titlePrefix} ${imageId || fallbackIndex}`
      : imageId || `Offer ${fallbackIndex}`;
    const title =
      cleanValue(pendingTitle) || textContent || altText || imgTitle || fallbackTitle;
    const affiliateUrl = cleanValue(pendingUrl) || href;

    if (!affiliateUrl) {
      return;
    }

    offers.push({
      title,
      affiliateUrl,
      imageUrl: imageUrl || undefined,
      priority: offerIndex + 1,
    });
    offerIndex += 1;
    pendingTitle = null;
    pendingUrl = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (anchorBuffer) {
      anchorBuffer = `${anchorBuffer}\n${rawLine}`;
      if (line.includes('</a>')) {
        pushOffer({anchorHtml: anchorBuffer, fallbackIndex: offerIndex + 1});
        anchorBuffer = null;
      }
      continue;
    }

    if (line.includes('<a')) {
      if (line.includes('</a>')) {
        pushOffer({anchorHtml: rawLine, fallbackIndex: offerIndex + 1});
      } else {
        anchorBuffer = rawLine;
      }
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      pendingUrl = line;
      continue;
    }

    pendingTitle = rawLine.trim();
  }

  return offers;
};

const purgeGroupOffers = async (db, groupId) => {
  const snapshot = await db
    .collection('affiliateOffers')
    .where('groupId', '==', groupId)
    .get();
  if (snapshot.empty) {
    return 0;
  }
  let deleted = 0;
  let batch = db.batch();
  let ops = 0;
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    ops += 1;
    deleted += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }
  return deleted;
};

const deactivateMissingOffers = async (db, groupId, keepIds) => {
  const snapshot = await db
    .collection('affiliateOffers')
    .where('groupId', '==', groupId)
    .get();
  if (snapshot.empty) {
    return 0;
  }
  let updated = 0;
  let batch = db.batch();
  let ops = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const doc of snapshot.docs) {
    if (keepIds.has(doc.id)) {
      continue;
    }
    batch.update(doc.ref, {
      isActive: false,
      updatedAt: now,
    });
    ops += 1;
    updated += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }
  return updated;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file;
  const groupId = args.groupId || args.groupid;
  if (!filePath || !groupId) {
    console.error(
      'Usage: node importAffiliateHtml.js --file <path> --groupId <id> [--title-prefix DJI] [--service-account <path>] [--project <id>] [--purge] [--deactivate-missing] [--dry-run]',
    );
    process.exit(1);
  }

  const titlePrefix = args['title-prefix'] || groupId.toUpperCase();
  const content = fs.readFileSync(path.resolve(filePath), 'utf8');
  const offers = parseOffersFromHtml(content, titlePrefix);
  if (offers.length === 0) {
    console.error('No offers found in HTML file.');
    process.exit(1);
  }

  const dryRun = Boolean(args['dry-run']);
  if (dryRun) {
    console.log(`Parsed ${offers.length} offers. Example:`);
    console.log(offers.slice(0, 3));
    process.exit(0);
  }

  const serviceAccountPath =
    args['service-account'] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath) {
    console.error(
      'Missing service account. Set --service-account or GOOGLE_APPLICATION_CREDENTIALS.',
    );
    process.exit(1);
  }
  const serviceAccount = require(path.resolve(serviceAccountPath));
  const projectId = args.project || serviceAccount.project_id;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
  });

  const db = admin.firestore();
  if (args.purge) {
    const deleted = await purgeGroupOffers(db, groupId);
    console.log(`Purged ${deleted} existing offers for group "${groupId}".`);
  }

  let batch = db.batch();
  let ops = 0;
  let imported = 0;
  const keepIds = new Set();
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (let i = 0; i < offers.length; i += 1) {
    const offer = offers[i];
    const docId = buildDocId(offer.affiliateUrl, groupId);
    keepIds.add(docId);
    const docRef = db.collection('affiliateOffers').doc(docId);
    batch.set(
      docRef,
      {
        ...offer,
        groupId,
        isActive: true,
        updatedAt: now,
        importedAt: now,
      },
      {merge: true},
    );
    ops += 1;
    imported += 1;
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) {
    await batch.commit();
  }

  console.log(
    `Imported ${imported} offers into affiliateOffers for group "${groupId}".`,
  );

  if (args['deactivate-missing']) {
    const updated = await deactivateMissingOffers(db, groupId, keepIds);
    console.log(`Deactivated ${updated} offers not in this import.`);
  }

  process.exit(0);
};

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
