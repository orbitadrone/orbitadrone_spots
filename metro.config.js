// Minimal Metro configuration compatible with RN 0.82 and Windows/Node.
// Uses the default config and avoids deep imports from metro-config internals.
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/** @type {import('metro-config').ConfigT} */
const customConfig = {
  // Keep empty; defaults are fine for release bundling
};

module.exports = mergeConfig(getDefaultConfig(__dirname), customConfig);

