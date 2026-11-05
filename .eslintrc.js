module.exports = {
  root: true,
  extends: '@react-native/eslint-config',
  ignorePatterns: [
    'android/build/**',
    'android/app/build/**',
    '.gradle/**',
    '.tmp/**',
  ],
  overrides: [
    {
      files: ['jest.setup.js', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
      env: {
        jest: true,
        node: true,
      },
    },
    {
      files: ['backend/**/*.js'],
      env: {
        node: true,
      },
    },
  ],
};
