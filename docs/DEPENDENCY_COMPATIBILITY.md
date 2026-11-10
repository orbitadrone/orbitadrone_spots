# Dependency Compatibility

## Goal

This project pins key dependency versions on purpose. The current Android target stack is ahead of part of the React Native ecosystem, and several libraries still require local compatibility patches to stay stable on React Native `0.83.1`, Android SDK `36`, the current New Architecture constraints, and Gradle `9` moving toward `10`.

## Why Versions Are Exact

- `patch-package` is part of the normal install flow.
- If a patched dependency drifts even one patch version, the patch can stop applying cleanly or, worse, apply against the wrong upstream code.
- `npm run verify:deps` exists to fail fast when a patched dependency version changes without reviewing its patch.

## Active Patched Dependencies

### Runtime and platform compatibility

- `@react-navigation/stack@7.6.8`
  Reason: patch retained for stack/interaction behaviour under the current navigation runtime.
- `react-native-config@1.6.1`
  Reason: local compatibility adjustments for the current React Native native/module setup.
- `react-native-video@6.18.0`
  Reason: Android-specific compatibility around the current activity/PiP/native integration path.
- `react-native-image-picker@8.2.1`
  Reason: compile SDK compatibility alignment with the app Android toolchain.
- `react-native-webview@13.10.2`
  Reason: local null-safety/runtime compatibility fix.
- `react-native-compressor@1.13.0`
  Reason: local native-path adjustment kept to avoid regressions in media compression flows.

### Gradle 10 Groovy DSL compatibility

- `@react-native-async-storage/async-storage@1.24.0`
- `@react-native-community/checkbox@0.5.20`
- `@react-native-community/geolocation@3.4.0`
- `react-native-compressor@1.13.0`
- `react-native-config@1.6.1`
- `react-native-fs@2.20.0`
- `react-native-gesture-handler@2.30.0`
- `react-native-google-mobile-ads@13.6.1`
- `react-native-image-crop-picker@0.51.1`
- `react-native-image-picker@8.2.1`
- `react-native-maps@1.26.20`
- `react-native-safe-area-context@5.6.2`
- `react-native-screens@4.19.0`
- `react-native-vector-icons@10.3.0`
- `react-native-video@6.18.0`
- `react-native-webview@13.10.2`
  Reason: these patches only normalize deprecated Groovy `prop value` assignments to `prop = value` in Android `build.gradle` files so the project stops accumulating Gradle `10` deprecations without changing runtime behaviour.

One upstream warning still remains outside the app's own Gradle scripts: `@react-native-firebase/app@23.5.0` triggers a `url/name` Groovy assignment deprecation through the external `io.invertase.gradle.build` plugin invoked from its Android build file. That one is intentionally not patched locally because it does not come from a stable text file in the repo or the package sources we can safely maintain with `patch-package`.

## Toolchain Notes

- `baseline-browser-mapping` is declared directly in `devDependencies` to keep the lint/test toolchain from warning about stale Baseline metadata.
- `@firebase/rules-unit-testing` is pinned to `5.0.0` because that is the first current line compatible with `firebase@12.x`.
- The repo standard is now Node `22` at the root (`.nvmrc`, `.node-version`, root `package.json`) and in `functions/`.
- That choice is intentional: Firebase Functions already targets `nodejs22`, the React Native `0.83.1` toolchain in this project has been verified locally on Node `22`, and keeping the repo on the same LTS line avoids depending on an arbitrary shell default such as `Node 25.x`.

## Practical Rule

Before changing any patched dependency:

1. update the dependency version intentionally
2. review whether the patch is still needed
3. regenerate or remove the patch
4. run `npm run verify:deps`
5. run the relevant app verification flow
