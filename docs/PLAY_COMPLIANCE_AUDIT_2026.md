# Android / Google Play Compliance Audit

Fecha de corte: `2026-03-17`

## Baseline actual

- `targetSdkVersion` y `compileSdkVersion`: `36`
- `minSdkVersion`: `24`
- Java/Kotlin: `17`
- Motor JS: Hermes
- Firebase App Check activo con Play Integrity
- Backups Android deshabilitados (`allowBackup=false`, `dataExtractionRules`, `backup_rules`)

Conclusión: la app Android ya está por encima del mínimo actual de Google Play para updates y nuevas subidas (`API 35` desde el `2025-08-31`). `36` tiene sentido aquí porque el proyecto ya venía estabilizado sobre React Native `0.83.1` y SDK `36`; no es una subida arbitraria.

## Permisos declarados y motivo

- `INTERNET`, `ACCESS_NETWORK_STATE`
  Motivo: Firebase, backend Bunny, mapas, ads y notificaciones.
- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`
  Motivo: mapa, nearby spots y marker del piloto. Flujo actual endurecido: el mapa principal ya no lo pide al abrirse; la solicitud ocurre al centrar en la ubicación del usuario o en pantallas de creación que realmente lo necesitan.
- `POST_NOTIFICATIONS`
  Motivo: FCM. Flujo actual endurecido: ya no se solicita al iniciar sesión; se sincroniza en silencio si ya estaba concedido y la solicitud explícita queda ligada al acceso al centro de actividad.
- `CAMERA`
  Motivo: captura de foto dentro de `AddSpot`.
- `com.android.vending.BILLING`
  Motivo: RevenueCat / Google Play Billing.

### Permiso retirado

- `RECORD_AUDIO`
  Motivo de retirada: no existe flujo activo de grabación de video/audio dentro de la app. `CreateDronePost` selecciona video desde galería y `AddSpot` usa `launchCamera` solo en modo foto. Mantener micrófono sin uso real aumentaba superficie de revisión en Play y de privacidad sin beneficio funcional.

## Data safety a revisar en Play Console

Antes de cada release, revisar que la ficha de Data safety siga alineada con el comportamiento real de la app y sus SDK:

- ubicación aproximada y precisa
- fotos y videos subidos por el usuario
- perfil de usuario y contenido generado por usuario
- notificaciones push
- billing / compras dentro de la app
- telemetría de fallos si Crashlytics está activa en release

Si un dato deja de usarse o cambia el flujo de recogida, primero se corrige la app y luego la ficha de Play Console. No al revés.

## Account deletion

La base cubre el requisito visible en dos frentes:

- borrado iniciable dentro de la app
- enlace web de borrado para Play Console

Endurecimiento aplicado en código: el cliente ya no borra primero `users/{uid}`. El origen del proceso pasa a ser el borrado de Firebase Auth y una función backend elimina `users/{uid}` para disparar la cascada existente sobre spots, posts, eventos, reviews, likes y tokens.

## Riesgos no bloqueantes abiertos

- El stack depende de `patch-package`; por eso `package.json` y `package-lock.json` deben mantenerse fijados y pasar `npm run verify:deps`.
- La mayor parte de la compatibilidad con Gradle `10` ya quedó resuelta mediante parches locales sobre librerías Android directas. Queda un warning upstream en el plugin Gradle que usa `@react-native-firebase/app@23.5.0` (`io.invertase.gradle.build`), invocado desde [build.gradle](/home/tomyorbitadrone/orbitadrone_spots_app/node_modules/@react-native-firebase/app/android/build.gradle). No nace de los `build.gradle` propios de la app.
- El baseline local del repo ya queda alineado en `Node 22`, en coherencia con `functions` sobre `nodejs22` y con validación local del flujo Android/debug bajo esa versión.
