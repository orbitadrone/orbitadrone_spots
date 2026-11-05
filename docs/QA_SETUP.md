# QA Configuration Checklist

## Estado de plataformas (24 de febrero de 2026)
- **Android:** QA activo y prioritario.
- **iOS:** **no está preparado** para publicación; se trabajará más adelante.
  - Mantén la configuración iOS en el repo, pero no generes builds de tienda ni distribuciones oficiales todavía.
  - **Todos los tests de la app deben distribuirse vía Google Play** (Internal testing / Closed testing). No usar APK/AAB fuera de Play.
  - **Cada build de pruebas requiere subir un AAB** y **aumentar `versionCode`** (y `versionName` si aplica).

1. **Google Maps API (por plataforma)**
   - **Android**: define `GOOGLE_MAPS_API_KEY_ANDROID` en `android/local.properties`, en `gradle.properties` del entorno CI o como variable de entorno antes de lanzar Gradle. El valor se inyecta en `@string/google_maps_api_key`.
   - **iOS**: agrega `GOOGLE_MAPS_API_KEY_IOS` al `.env`. El `AppDelegate` lo lee vía `react-native-config` para inicializar Google Maps (si el SDK está disponible) y para Geocoder en JS.
   - Mantén `GOOGLE_MAPS_API_KEY` como fallback común solo para desarrollo local.

2. **Firebase SHA-1 para pruebas Android**
   - Asegura que el proyecto Firebase tenga **también** el SHA-1 de debug (además del de producción).
   - SHA-1 debug actual de este entorno: `18:88:80:85:D1:66:2C:5F:C4:71:5B:B1:8B:BC:01:12:CE:C6:F0:8B`.
   - Para recalcularlo localmente:
     ```bash
     keytool -list -v \
       -alias androiddebugkey \
       -keystore android/app/debug.keystore \
       -storepass android \
       -keypass android | rg "SHA1"
     ```
   - Tras añadir el SHA-1 en Firebase Console, descarga `google-services.json` actualizado y reemplaza `android/app/google-services.json`.

3. **RevenueCat keys**
   - Las claves se leen por plataforma: define `PURCHASES_API_KEY_ANDROID`, `PURCHASES_API_KEY_IOS` y, opcionalmente, `PURCHASES_API_KEY` como fallback común en el `.env`.
   - El arranque de la app registra una advertencia si falta la clave correspondiente al dispositivo.

4. **GoogleService-Info (iOS)**
   - **iOS no está listo para release.** Por ahora solo mantenemos el template `ios/GoogleService-Info.plist.template`.
   - Cuando se retome iOS, se deberá generar el `GoogleService-Info.plist` real y verificar que esté incluido en el target correcto.

5. **Runtime de Node**
   - El estándar del repo es **Node `22`**.
   - Está fijado en `.nvmrc`, `.node-version`, `package.json` y alineado con `functions/`.
   - La razón no es arbitraria: `functions` ya despliega sobre `nodejs22`, y el stack actual del repo (`verify:core`, `verify:android` y `assembleDebug`) se ha validado localmente con Node `22`, evitando además depender del shell local en `Node 25.x`.

6. **Permisos nativos**
   - **Android**: solicitamos ubicación, cámara y notificaciones desde `requestEssentialPermissions`. La selección de fotos y vídeos usa el Photo Picker sin permisos de galería.
   - **iOS**: se añadieron descripciones de uso de micrófono, cámara, ubicación y librería en `Info.plist`. Confirma que el texto sea consistente antes de subir a la tienda.

7. **General secret handling**
   - Nunca vuelvas a commitear `.env`: duplica `cp .env.example .env` y rellena los valores de forma local o vía variables de entorno/secretos de CI.
   - Para la firma Android, copia `cp android/keystore.properties.example android/keystore.properties` (el archivo real está gitignored) o exporta `ORBITA_KEYSTORE_*` antes de ejecutar Gradle.
   - Mantén el keystore fuera del repo (por ejemplo `${HOME}/.orbitadrone/keystores/orbitadrone_release.keystore`) y sincronízalo solo por un canal seguro.
   - Valida la configuración con `npm run verify:release-signing`. Para una comprobación estricta antes de release/CI, usa `npm run verify:release-signing:strict`.
   - Para QA en Android, valida la configuración desde Google Play (Internal testing / Closed testing) y confirma que Maps, login, compras y ads inicialicen sin warnings.
   - Recuerda incrementar `versionCode` antes de cada subida a Play.

8. **Smoke test de borrado de cuenta**
   - Comando:
     ```bash
     npm run smoke:account-deletion
     ```
   - Este smoke test usa el proyecto Firebase real `orbitadrone-84049`, crea un usuario temporal de Auth y documentos temporales en Firestore, y valida el flujo completo:
     `Auth delete -> onAuthUserDeletedCleanup -> delete users/{uid} -> onUserProfileDeletedCleanup`.
   - En un resultado correcto, la salida debe incluir `authDeletion.deleted: true` y `cascadeCleanup.completed: true`.
   - Requisito operativo: tener una sesión válida del Firebase CLI (`./node_modules/.bin/firebase login:list`).
   - No sustituye la prueba UX dentro de la app; complementa la validación técnica del backend.
