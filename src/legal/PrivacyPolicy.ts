export const privacyPolicyText = `
# Política de Privacidad – Orbitadrone Spots

**Última actualización: 2026-03-17**

Gracias por usar Orbitadrone Spots. Sabemos que el tema “datos/privacidad” suele sonar tostón, así que iremos al grano y sin humo.

Este documento explica qué datos recogemos, por qué, y cómo puedes ejercer control.

## 1 · El responsable

Orbitadrone – Aplicación móvil “Orbitadrone Spots”.

Contacto oficial para temas de privacidad: orbitadrone22@gmail.com

## 2 · Qué datos recolectamos

Recogemos datos porque la app literalmente no puede funcionar sin ellos (ejemplo: mapa / spots / login).

### Cuenta y perfil
- Email
- Nombre / alias
- Foto de perfil y portada
- Redes sociales que tú decidas poner
- Preferencias de vuelo

### Datos de contenido (publicaciones)
- Spots que creas (ubicación aproximada, fotos y/o video)
- Comentarios y reseñas
- Estadísticas del spot (calculo de rating etc.)

### Datos técnicos
- Idioma elegido en la app
- Modelo del dispositivo
- ID de notificación (token FCM)
- Versión de la app
- Datos de diagnóstico y fallos cuando la telemetría de errores está activa

### Ubicación
Solo se usa para centrar el mapa y para autocompletar direcciones. No vendemos datos de ubicación. Nunca.

### Multimedia
- Imágenes suben a Firebase Storage
- Vídeos suben a Bunny Stream

## 3 · Por qué los usamos
- Para autenticarte (Firebase Auth)
- Para guardar spots, reseñas y perfiles (Firestore)
- Para guardar y mostrar imágenes y videos (Storage + Bunny)
- Para enviar notificaciones push y deep links
- Para mostrar anuncios con AdMob y gestionar tus preferencias de publicidad

Todo orientado a que la app funcione.

## 4 · Publicidad y monetización
Usamos AdMob. Puedes ver un anuncio recompensado de forma voluntaria para pausar la publicidad durante la sesión. No ofrecemos compras ni membresías de pago dentro de la app. No vendemos tus datos a terceros. Sí usamos datos técnicos “anónimos” para que el proveedor muestre anuncios relevantes.

## 5 · Permisos que pedimos
- Ubicación
- Cámara / galería
- Notificaciones

Todos se piden explícitamente en el móvil.

## 6 · Tus derechos
Tienes derecho a:
- Acceder
- Rectificar
- Borrar tu cuenta
- Borrar contenido que hayas creado

Hoy la app permite borrar la cuenta desde el perfil. Si necesitas solicitar una copia de tus datos o ejercer otros derechos, puedes escribirnos al correo de contacto.

Cuando eliminas tu cuenta:
- Iniciamos la eliminación de tu acceso y de los datos asociados a la cuenta
- Retiramos o invalidamos los tokens de notificación vinculados a tu perfil
- Podemos conservar la mínima información necesaria cuando exista una obligación legal, antifraude o de seguridad

## 7 · Seguridad
Usamos App Check de Firebase para evitar abuso automatizado y reglas de acceso en backend para proteger los datos. Algunas claves y configuraciones de cliente forman parte de la app porque son necesarias para conectar con servicios externos; las credenciales con privilegios no se exponen en el cliente.

## 8 · Cambios a este documento
Si cambiamos algo importante, te avisaremos dentro de la app.

## 9 · Contacto
orbitadrone22@gmail.com
`;
