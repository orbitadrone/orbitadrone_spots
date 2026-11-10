# Release Android Checklist (Orbitadrone Spots)

Android es la plataforma activa. Prepara el entorno una vez con `npm run setup` y configura Firebase, Maps y la firma local.

## 1) Preflight
- Node.js `22` LTS, JDK `17`, Android SDK `36` + Build Tools `36.0.0`.
- `.env` completo (Firebase, Maps y Bunny).
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

## 4) Legal / Compliance
- Confirmar textos legales actualizados en:
  - `src/legal/PrivacyPolicy.ts`
  - `src/legal/TermsOfService.ts`
- Revisar enlace web de eliminación de cuenta (orbitadrone.com).
- Confirmar que la ficha de `Data safety` refleja el comportamiento real y los SDK usados.
- Revisar los permisos declarados de ubicación, cámara y notificaciones antes de cada release.

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
- Guarda los cambios de código y versión en un commit antes de compilar.
- Ejecuta `npm run release:android` desde la raíz. El comando comprueba la firma y ejecuta Gradle.
- Encontrarás el AAB en `dist/android/`, junto a un archivo con la versión, el commit y el SHA-256 del AAB.
- Sube el AAB a **Internal testing** o **Closed testing** en Google Play Console.

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
