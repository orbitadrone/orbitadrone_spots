// Minimal Metro configuration compatible con RN 0.82 y entornos Windows/WSL.
// Usa la configuración por defecto y fuerza maxWorkers = 1 para evitar
// usar jest-worker (que está fallando al bundlear en /mnt/c).
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/** @type {import('metro-config').ConfigT} */
const customConfig = {
  maxWorkers: 1,
};

module.exports = mergeConfig(getDefaultConfig(__dirname), customConfig);
