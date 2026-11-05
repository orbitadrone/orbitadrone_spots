# OrbitaDrone Spots (Linux/WSL)

Guía para desarrollar y compilar este proyecto (creado en Windows) desde un entorno Linux o WSL.

## Estado de plataformas (24 de febrero de 2026)
- **Android:** desarrollo y QA activos.
- **iOS:** **no está preparado** para publicación; se trabajará más adelante.
  - Mantén el soporte iOS en el repo, pero no generes builds de tienda ni distribuciones oficiales todavía.

## Qué hay en el repo
- **App móvil:** React Native 0.83.1 (Android/iOS en el repo, pero **solo Android activo por ahora**) con Firebase, Google Maps, RevenueCat y Bunny.
- **backend/:** servicio Express para subir videos a Bunny.
- **functions/:** Cloud Functions de Firebase para notificaciones.

## Prerrequisitos
- Node.js 20 LTS y npm.
- JDK 17 (React Native 0.83.x lo requiere).
- Android Studio con SDK 36, Build Tools 36.0.0, NDK 27.1.12297006 y CMake 3.30.5.
- Emulador o dispositivo Android con `adb` accesible (en WSL funciona mejor si el repo vive en el disco ext4, no en `/mnt/c`).
- Ruby/CocoaPods solo si vas a compilar iOS en macOS **(iOS no está listo para release por ahora)**.

## Configuración inicial (Linux/WSL)
1) Instala dependencias del proyecto:
```
nvm use || true
npm install
```
2) Copia y rellena variables:
```
cp .env.example .env   # Llena claves de Firebase, Maps y RevenueCat
```
3) Android SDK/local props (`android/local.properties`):
```
sdk.dir=/home/<tu_usuario>/Android/Sdk
GOOGLE_MAPS_API_KEY_ANDROID=<tu_api_key>
```
4) Firma Android (solo para release): copia `android/keystore.properties.example` a `android/keystore.properties` y apunta a tu keystore o exporta `ORBITA_KEYSTORE_*` en el entorno.
5) Si `gradlew` pierde permisos en Linux: `chmod +x android/gradlew`.

## Ejecutar la app en Android
1) Arranca Metro en una terminal:
```
npm run start
# o para limpiar caché:
npx react-native start --reset-cache
```
2) Con un emulador/dispositivo listo:
```
npm run android
```
Notas:
- Metro está configurado con `maxWorkers: 1` para evitar problemas típicos de WSL/jest-worker.
- Si usas dispositivo físico: `adb reverse tcp:8081 tcp:8081` ayuda a que Metro sea accesible.

## iOS (pendiente)
- El código existe, pero **iOS no está preparado para publicación**. Prioridad actual: robustez en Android.

## Backend (Bunny uploader)
```
cd backend
cp .env.example .env    # crea el archivo con tus claves de Bunny y Firebase
npm install
npm start               # puerto 3000 por defecto
```
En la app móvil apunta `BUNNY_UPLOAD_ENDPOINT` en `.env` al host:puerto del backend.

## Firebase Functions
```
cd functions
npm install
firebase emulators:start --only functions   # requiere Firebase CLI
```
Define las credenciales de servicio en variables de entorno o con `GOOGLE_APPLICATION_CREDENTIALS`.

## Comandos útiles
- Pruebas: `npm test`
- Reglas Firestore: `npm run test:rules`
- Lint: `npm run lint`
- Verificación base: `npm run verify:core`
- Verificación Android pre-release: `npm run verify:android`
- Arranque rápido sólo de bundler: `npm run start`

## Release Android
Consulta `docs/RELEASE_ANDROID.md`.

## Diferencias respecto a Windows
- Evita trabajar dentro de `/mnt/c` en WSL para no sufrir problemas de watchers o permisos; usa el sistema de archivos de la distro.
- Las rutas en `comandos.txt` apuntaban a `C:\...`; desde Linux usa las rutas del proyecto actual.
- La versión de Java, SDK y NDK ya están fijadas en Gradle; Android Studio en Linux las descarga automáticamente si las marcas en SDK Manager.
- El estándar del repo para Node es `22` (`.nvmrc`, `.node-version` y `package.json`). La decisión no es arbitraria: `functions/` ya corre sobre `nodejs22`, el stack React Native `0.83.1` ha sido verificado localmente con `Node 22`, y así evitamos depender del shell local en `Node 25.x`, que era la fuente del warning operativo.
