const fs = require('fs');
const path = require('path');
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

const parseCsv = (content) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const text = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      field = '';
      if (row.some(value => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    if (char === '\r') {
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some(value => value.length > 0)) {
    rows.push(row);
  }
  return rows;
};

const normalizeHeader = (value) => value.replace(/^\uFEFF/, '').trim();

const cleanValue = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') {
    return null;
  }
  return trimmed;
};

const parseQuantity = (value) => {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return null;
  }
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const parseDate = (value) => {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return null;
  }
  const date = new Date(cleaned);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return admin.firestore.Timestamp.fromDate(date);
};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const pickFirst = (...values) => values.find(value => Boolean(cleanValue(value)));

const buildOffer = (row, headerMap, groupId, index) => {
  const get = (name) => row[headerMap[name]];
  const title = cleanValue(get('Product name'));
  const productId = cleanValue(get('ProductID'));
  const affiliateUrl = pickFirst(
    get('Coupon Standard Link'),
    get('Coupon Short Link'),
    get('Product Standard Link'),
    get('Product Short Link'),
  );
  if (!title || !affiliateUrl) {
    return null;
  }
  const offer = {
    groupId,
    title,
    affiliateUrl,
    imageUrl: cleanValue(get('Image')),
    couponCode: cleanValue(get('Coupon code')),
    couponPrice: cleanValue(get('Coupon price')),
    originalPrice: cleanValue(get('Original price')),
    discountLabel: cleanValue(get('Discount')),
    categories: cleanValue(get('Categories')),
    warehouse: cleanValue(get('Warehouse')),
    quantity: parseQuantity(get('Quantitly')),
    productId,
    poaId: cleanValue(get('poaID')),
    updatedAt: parseDate(get('Update time')),
    startsAt: parseDate(get('Start time')),
    endsAt: parseDate(get('End time')),
    isActive: true,
    importedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const docId =
    productId ||
    `banggood-${slugify(title).slice(0, 60) || `offer-${index}`}`;
  return {docId, offer};
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

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file;
  if (!filePath) {
    console.error('Usage: node importBanggoodCsv.js --file <path> [--groupId banggood] [--service-account <path>] [--project <id>] [--purge]');
    process.exit(1);
  }
  const serviceAccountPath =
    args['service-account'] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath) {
    console.error('Missing service account. Set --service-account or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const serviceAccount = require(path.resolve(serviceAccountPath));
  const projectId = args.project || serviceAccount.project_id;
  const groupId = args.groupId || 'banggood';

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
  });

  const db = admin.firestore();
  const csvText = fs.readFileSync(path.resolve(filePath), 'utf8');
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    console.error('CSV is empty.');
    process.exit(1);
  }

  const headers = rows[0].map(normalizeHeader);
  const headerMap = headers.reduce((acc, header, index) => {
    acc[header] = index;
    return acc;
  }, {});

  const requiredHeaders = ['Product name', 'Coupon Standard Link'];
  const hasHeaders = requiredHeaders.every((header) => headerMap[header] !== undefined);
  if (!hasHeaders) {
    console.warn('CSV headers detected:', headers.join(', '));
    console.warn('Expected at least: Product name, Coupon Standard Link');
  }

  if (args.purge) {
    const deleted = await purgeGroupOffers(db, groupId);
    console.log(`Purged ${deleted} existing offers for group "${groupId}".`);
  }

  let batch = db.batch();
  let ops = 0;
  let imported = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const result = buildOffer(rows[i], headerMap, groupId, i);
    if (!result) {
      continue;
    }
    const {docId, offer} = result;
    const docRef = db.collection('affiliateOffers').doc(docId);
    batch.set(docRef, offer, {merge: true});
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

  console.log(`Imported ${imported} offers into affiliateOffers for group "${groupId}".`);
  process.exit(0);
};

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
