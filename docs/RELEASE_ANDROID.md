# Release Android Checklist (Orbitadrone Spots)

Estado actual: **solo Android está listo para release**. iOS sigue pendiente.

## 1) Preflight
- Node.js `22` LTS, JDK `17`, Android SDK `36` + Build Tools `36.0.0`.
- `.env` completo (Firebase, Maps, RevenueCat, Bunny).
- `android/local.properties` con `sdk.dir` y `GOOGLE_MAPS_API_KEY_ANDROID`.
- `android/app/google-services.json` correcto para el proyecto Android.
- Firma release validada:
  - `npm run verify:release-signing`
  - Para la comprobación estricta previa a publicación/CI: `npm run verify:release-signing:strict`
- Backend Bunny operativo y `BUNNY_UPLOAD_ENDPOINT` apuntando a producción.
- Revisar `docs/DEPENDENCY_COMPATIBILITY.md` y `docs/PLAY_COMPLIANCE_AUDIT_2026.md`.
- Ejecutar `nvm use` si estás usando `nvm`.

## 2) Versión
- Incrementar `versionCode` y `versionName` en `android/app/build.gradle`.
- **Obligatorio para pruebas en Google Play:** cada subida requiere un `versionCode` nuevo (no se puede reutilizar).

## 3) Ads / Monetización
- Verificar App ID AdMob Android en `app.json`.
- Verificar Ad Unit IDs Android en `src/constants/adUnits.ts`.
- Confirmar RevenueCat keys (`PURCHASES_API_KEY_ANDROID`) en `.env`.

## 4) Legal / Compliance
- Confirmar textos legales actualizados en:
  - `src/legal/PrivacyPolicy.ts`
  - `src/legal/TermsOfService.ts`
- Revisar enlace web de eliminación de cuenta (orbitadrone.com).
- Confirmar que la ficha de `Data safety` refleja el comportamiento real y los SDK usados.
- Revisar permisos declarados antes de cada release. En el estado actual deben quedar solo: ubicación, cámara, notificaciones y billing.

## 5) Seguridad / Reglas
- Firestore rules actualizadas en `firestore.rules`.
- Dependencias parcheadas alineadas:
  - `npm run verify:deps`
- Tests de reglas (requiere emulador):
  - `npm run test:rules`
- Smoke test técnico de borrado de cuenta en Firebase real:
  - `npm run smoke:account-deletion`
  - Debe devolver `authDeletion.deleted: true` y `cascadeCleanup.completed: true`

## 6) Calidad
- Verificación base:
  - `npm run verify:core`
- Verificación Android completa antes de release:
  - `npm run verify:android`
 - Build local de sanity:
   - `cd android && ./gradlew :app:assembleDebug`
- Verificación funcional adicional antes de publicar:
  - probar desde la app el flujo de borrado de cuenta con una cuenta de QA y confirmar que el resultado visible coincide con el smoke test backend

## 7) Build Release (AAB)
- Exportar credenciales de firma (`ORBITA_KEYSTORE_*`) o usar `android/keystore.properties`.
- El keystore debe vivir fuera del repo. En local, usa una ruta tipo `${HOME}/.orbitadrone/keystores/...`.
- Para automatización/CI, activa el modo estricto:
  - `ORBITA_ENFORCE_SECURE_KEYSTORE=true ./gradlew clean bundleRelease`
- Build:
  - `cd android && ./gradlew clean bundleRelease`
- Artefacto:
  - `android/app/build/outputs/bundle/release/app-release.aab`
 - **Este AAB es el que se sube a Internal / Closed testing.**

## 8) Distribución de pruebas (obligatorio vía Google Play)
- **Todas las pruebas de la app deben distribuirse por Google Play.**
- Subir el AAB a **Internal testing** o **Closed testing**.
- Asignar testers y verificar que instalan/actualizan desde Play.
- Revisar el **Pre‑launch report** antes de pasar a producción.
- No distribuir APK/AAB por fuera de Play (sideload/ADB/links directos).

## 9) Crashlytics (opcional)
- Subir mapping si aplica:
  - `./gradlew uploadCrashlyticsMappingFileRelease -PcrashlyticsMappingUpload`

## 10) Play Console
- Subir AAB.
- Completar checklist de “App integrity”, “Data safety” y “Content rating”.
- Verificar listing, capturas y enlaces (privacidad, eliminación cuenta).
- Verificar que el target API declarado sigue cumpliendo el requisito vigente de Google Play.
