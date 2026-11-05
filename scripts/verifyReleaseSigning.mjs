import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'android');
const appDir = path.join(androidDir, 'app');

const truthyValues = new Set(['1', 'true', 'yes', 'on']);
const isTruthy = value =>
  typeof value === 'string' && truthyValues.has(value.trim().toLowerCase());

const readPropertiesFile = filePath => {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const entries = new Map();
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) {
      entries.set(key, value);
    }
  });
  return entries;
};

const keystorePropertiesPath = path.join(androidDir, 'keystore.properties');
const localPropertiesPath = path.join(androidDir, 'local.properties');
const keystoreProperties = readPropertiesFile(keystorePropertiesPath);
const localProperties = readPropertiesFile(localPropertiesPath);

const resolveSigningProperty = propertyName =>
  [
    keystoreProperties.get(propertyName),
    localProperties.get(propertyName),
    process.env[propertyName],
  ].find(value => typeof value === 'string' && value.trim());

const strict =
  process.argv.includes('--strict') ||
  isTruthy(process.env.ORBITA_ENFORCE_SECURE_KEYSTORE) ||
  isTruthy(process.env.CI);

const keystorePathRaw = resolveSigningProperty('ORBITA_KEYSTORE_FILE');
const problems = [];
const warnings = [];

if (keystoreProperties.size > 0) {
  warnings.push(
    'android/keystore.properties exists. Keep it local-only and avoid using it in CI/shared release automation.',
  );
}

if (!keystorePathRaw) {
  problems.push(
    'ORBITA_KEYSTORE_FILE is not configured. Provide ORBITA_KEYSTORE_* via env vars or android/keystore.properties for signed release builds.',
  );
} else {
  const resolvedKeystorePath = path.resolve(appDir, keystorePathRaw);
  const relativeToProject = path.relative(projectRoot, resolvedKeystorePath);
  const isInsideProjectTree =
    relativeToProject === '' ||
    (!relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject));

  if (isInsideProjectTree) {
    problems.push(
      `Release keystore resolves inside the project tree: ${resolvedKeystorePath}. Move it outside the repo and provide ORBITA_KEYSTORE_FILE with an external path.`,
    );
  }

  if (!fs.existsSync(resolvedKeystorePath)) {
    problems.push(`Configured keystore file does not exist: ${resolvedKeystorePath}`);
  }
}

warnings.forEach(message => {
  console.warn(`[verify:release-signing] WARN ${message}`);
});

if (problems.length === 0) {
  console.log('[verify:release-signing] OK release signing path is configured.');
  process.exit(0);
}

problems.forEach(message => {
  const prefix = strict ? 'ERROR' : 'WARN';
  const stream = strict ? console.error : console.warn;
  stream(`[verify:release-signing] ${prefix} ${message}`);
});

if (strict) {
  process.exit(1);
}

console.log(
  '[verify:release-signing] Non-strict mode completed with warnings. Use --strict or ORBITA_ENFORCE_SECURE_KEYSTORE=true to fail insecure release signing setups.',
);
