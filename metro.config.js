// Minimal Metro configuration compatible con RN 0.82 y entornos Windows/WSL.
// Usa la configuración por defecto y fuerza maxWorkers = 1 para evitar
// usar jest-worker (que está fallando al bundlear en /mnt/c).
const path = require('path');
const {default: exclusionList} = require('metro-config/private/defaults/exclusionList');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/** @type {import('metro-config').ConfigT} */
const customConfig = {
  maxWorkers: 1,
  resolver: {
    // Avoid watching large build/cache folders that exhaust inotify handles in CI/sandboxes
    blockList: exclusionList([
      /.*\/\.gradle\/.*/,
      /.*\/android\/build\/.*/,
      /.*\/ios\/build\/.*/,
    ]),
  },
  watchFolders: [path.resolve(__dirname, 'node_modules')],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), customConfig);
