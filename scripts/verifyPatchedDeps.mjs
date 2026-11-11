import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, 'package.json');
const patchesDir = path.join(rootDir, 'patches');

const isExactVersion = value => /^\d+\.\d+\.\d+(-.+)?$/.test(value);

const parsePatchedDependency = stem => {
  const parts = stem.split('+');
  if (parts[0]?.startsWith('@')) {
    return {
      packageName: `${parts[0]}/${parts[1]}`,
      version: parts.slice(2).join('+'),
    };
  }
  return {
    packageName: parts.slice(0, -1).join('+'),
    version: parts.at(-1) ?? '',
  };
};

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const declaredVersions = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
const patchFiles = (await readdir(patchesDir))
  .filter(fileName => fileName.endsWith('.patch'))
  .sort();

const problems = [];
const checkedPackages = [];

for (const fileName of patchFiles) {
  const stem = fileName.replace(/\.patch$/, '');
  const {packageName, version} = parsePatchedDependency(stem);
  const declaredVersion = declaredVersions[packageName];

  if (!packageName || !version) {
    problems.push(`No se pudo interpretar el patch ${fileName}`);
    continue;
  }

  if (!declaredVersion) {
    problems.push(`${packageName} tiene patch (${version}) pero no está declarado en package.json`);
    continue;
  }

  if (!isExactVersion(declaredVersion)) {
    problems.push(
      `${packageName} debe estar fijado a versión exacta por usar patch-package. Actual: ${declaredVersion}`,
    );
  }

  if (declaredVersion !== version) {
    problems.push(
      `${packageName} tiene patch para ${version} pero package.json declara ${declaredVersion}`,
    );
  }

  checkedPackages.push(`${packageName}@${version}`);
}

if (problems.length > 0) {
  console.error('[verify:deps] Inconsistencias detectadas:');
  problems.forEach(problem => {
    console.error(`- ${problem}`);
  });
  process.exit(1);
}

console.log(
  `[verify:deps] ${checkedPackages.length} dependencias parcheadas alineadas con package.json`,
);
