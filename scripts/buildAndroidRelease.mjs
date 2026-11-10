import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access, copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminó con código ${result.status}.`);
  return result.stdout?.trim();
}

try {
  if (!process.versions.node.startsWith('22.')) {
    throw new Error('Activa Node 22 antes de compilar.');
  }
  const git = args => run('git', args, {encoding: 'utf8'});
  if (git(['status', '--porcelain'])) {
    throw new Error('Guarda los cambios del proyecto en un commit antes de generar el AAB.');
  }
  const commit = git(['rev-parse', 'HEAD']);
  const gradleConfig = await readFile('android/app/build.gradle', 'utf8');
  const version = gradleConfig.match(/\bversionName\s*=\s*["'](\d+\.\d+\.\d+)["']/)?.[1];
  const versionCode = gradleConfig.match(/\bversionCode\s*=\s*(\d+)/)?.[1];
  if (!version || !versionCode) throw new Error('Revisa versionName y versionCode en android/app/build.gradle.');

  for (const file of ['.env', 'android/app/google-services.json']) {
    try {
      await access(file);
    } catch {
      throw new Error(`Falta ${file}. Recupera la configuración local antes de compilar.`);
    }
  }
  run(process.execPath, ['scripts/verifyReleaseSigning.mjs', '--strict'], {stdio: 'inherit'});
  const windows = process.platform === 'win32';
  run(windows ? 'cmd.exe' : './gradlew', windows ? ['/d', '/c', 'gradlew.bat', ':app:bundleRelease'] : [':app:bundleRelease'], {
    cwd: 'android',
    stdio: 'inherit',
    env: {...process.env, ORBITA_ENFORCE_SECURE_KEYSTORE: 'true'},
  });

  const name = `orbitadrone-${version}-${versionCode}-${commit.slice(0, 12)}`;
  const directory = join('dist', 'android', name);
  const bundleName = `${name}.aab`;
  const destination = join(directory, bundleName);
  await mkdir(directory, {recursive: true});
  await copyFile('android/app/build/outputs/bundle/release/app-release.aab', destination);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(destination)) hash.update(chunk);
  await writeFile(
    join(directory, 'build.json'),
    JSON.stringify({version, versionCode: Number(versionCode), commit, bundleName, sha256: hash.digest('hex')}, null, 2) + '\n',
  );
  console.log(`AAB listo en ${destination}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
