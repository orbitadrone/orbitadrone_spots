# QA Configuration Checklist

1. **Google Maps API (por plataforma)**
   - **Android**: define `GOOGLE_MAPS_API_KEY_ANDROID` en `android/local.properties`, en `gradle.properties` del entorno CI o como variable de entorno antes de lanzar Gradle. El valor se inyecta en `@string/google_maps_api_key`.
   - **iOS**: agrega `GOOGLE_MAPS_API_KEY_IOS` al `.env`. El `AppDelegate` lo lee vía `react-native-config` para inicializar Google Maps (si el SDK está disponible) y para Geocoder en JS.
   - Mantén `GOOGLE_MAPS_API_KEY` como fallback común solo para desarrollo local.

2. **RevenueCat keys**
   - Las claves se leen por plataforma: define `PURCHASES_API_KEY_ANDROID`, `PURCHASES_API_KEY_IOS` y, opcionalmente, `PURCHASES_API_KEY` como fallback común en el `.env`.
   - El arranque de la app registra una advertencia si falta la clave correspondiente al dispositivo.

3. **GoogleService-Info (iOS)**
   - El archivo `ios/GoogleService-Info.plist` ya está versionado para el entorno QA. Sustituye `GOOGLE_APP_ID` y `CLIENT_ID` por los valores reales del proyecto iOS en Firebase antes de generar un `archive`.
   - Si necesitas regenerarlo, mantén el formato XML y asegúrate de volver a incluirlo en el target principal.

4. **Permisos nativos**
   - **Android**: A partir de Tiramisu solicitamos `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `ACCESS_MEDIA_LOCATION`, `RECORD_AUDIO`, ubicación y cámara desde `requestEssentialPermissions`.
   - **iOS**: se añadieron descripciones de uso de micrófono, cámara, ubicación y librería en `Info.plist`. Confirma que el texto sea consistente antes de subir a la tienda.

5. **General secret handling**
   - Nunca vuelvas a commitear `.env`: duplica `cp .env.example .env` y rellena los valores de forma local o vía variables de entorno/secretos de CI.
   - Para la firma Android, copia `cp android/keystore.properties.example android/keystore.properties` (el archivo real está gitignored) o exporta `ORBITA_KEYSTORE_*` antes de ejecutar Gradle.
   - Mantén el keystore fuera del repo (por ejemplo `${PROJECT_ROOT}/android/keystores/orbitadrone_release.keystore`) y sincronízalo solo por un canal seguro.
   - For QA builds, validate the setup by running `npx react-native run-android` and confirming Maps, login, purchases, and ads initialize without warnings.
