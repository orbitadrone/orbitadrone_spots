# Procedencia del proyecto

Revisión del 5 de noviembre de 2026. Repositorio: `orbitadrone/orbitadrone_spots`.

| Copia revisada | Versión Android | versionCode | Contenido relevante |
| --- | --- | --- | --- |
| GitHub, commit `d4f6c6ee1fe7d31bf43f26f63f6c63c35d7e7dcd` | 1.1.5 | 115 | Incluye trabajo del feed, pero su navegación aún no lo conecta y le faltan archivos referenciados. |
| Subcarpeta `orbitadrone_spots+0.0.40` | 0.0.40 | 40 | Copia histórica sin feed; contiene tienda y configuración local. |
| Carpeta principal `orbitadrone_spots_app` | 1.1.18 | 128 | Feed conectado, eventos, administración, estilos, pruebas, reglas y parches de dependencias. |

La recuperación incorpora el código de la carpeta principal sobre el historial existente de GitHub. La subcarpeta 40 se conserva en el respaldo histórico, fuera del árbol activo. Los nombres de carpeta no determinan la versión: se consulta `android/app/build.gradle`.

Se han conservado respaldos locales de las dos fuentes, del historial completo de Git y de la configuración y firma privadas. Los archivos `.env`, keystores y propiedades locales no forman parte del código publicado. Se necesitan para volver a configurar una máquina o el entorno de compilación.

No se han desplegado funciones, reglas, cambios de base de datos ni una actualización de Google Play durante la recuperación. La validación de una compilación firmada y su prueba en Google Play son pasos posteriores, antes de retirar el respaldo original.
