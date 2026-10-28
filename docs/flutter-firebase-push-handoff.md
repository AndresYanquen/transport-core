# Contexto para implementar Firebase Push en Flutter — gotTaxi

Este es el contrato del backend implementado en este repositorio. La implementación Flutter está pendiente y debe adaptarse a su arquitectura actual. Que el código exista no acredita despliegue: confirmar con backend la URL del entorno, migración aplicada, secreto configurado y `PUSH_ENABLED=true` antes de probar entrega real.

## Actualización: Socket.IO primero y push de respaldo

El backend ahora añade `eventId` a `ride:invite-created` y espera una confirmación de presentación antes del respaldo FCM. Implementar reportes de visibilidad y el evento `ride:invite-presented` (o su alternativa HTTP), exclusivamente después de mostrar la tarjeta en foreground. El margen predeterminado es de dos segundos; un reporte reciente de background omite la espera inicial. Confirmar una instalación no silencia las otras.

Contrato completo, ejemplos y carreras: [Socket.IO primero y FCM como respaldo](push-socket-fallback.md). Reportar foreground por sí solo no suprime push. La implementación móvil sigue pendiente en su repositorio.

## Objetivo y arquitectura

Proyecto Firebase existente: **GotTaxi**, ID **`gottaxi-191c2`**. Configurar las aplicaciones Android/iOS/web correspondientes a ese proyecto; confirmar package name y bundle ID antes de descargar archivos de configuración.

La autenticación sigue siendo propia: JWT + OTP + sesiones por instalación. No implementar Firebase Authentication ni Firestore. Socket.IO mantiene el tiempo real; FCM avisa al usuario y permite volver al recurso. PostgreSQL/HTTP determinan el estado vigente y autorizan acciones.

Backend terminado: registro de dispositivos, rotación/reasignación de tokens, cola PostgreSQL, envío por Firebase Admin, reintentos acotados, descarte de avisos obsoletos y protección por sesión. Se admite más de un dispositivo por usuario.

La cuenta de servicio y `FIREBASE_SERVICE_ACCOUNT_JSON` son secretos exclusivos del backend; nunca deben estar en Flutter. Flutter usa su configuración de cliente Firebase y obtiene el token de registro FCM del SDK. No enviar como token FCM el token APNs, el JWT, el UUID `deviceId` ni un identificador Firebase Installation ID por sustitución automática: el contrato actual espera un token FCM.

## Autenticación e instalación

Flutter ya debe mantener un `deviceId` UUID v4 por instalación, usado en OTP y refresh. **Ese mismo UUID es el `installationId` de push.** No generar otro identificador para notificaciones. En reinstalación real se genera una instalación nueva según el contrato de autenticación existente.

Registrar push solo después de obtener una sesión móvil completa mediante OTP, con `session` en la respuesta. Tokens de inscripción de Google/correo sin sesión no habilitan la API push para pasajeros/conductores. No decodificar ni modificar JWT para crear una sesión; usar el estado autenticado que entrega el backend.

Documentación relacionada: `docs/flutter-auth-contract.md`, `docs/mobile-sessions.md` y `docs/firebase-push-backend.md`.

## API de dispositivos

Base URL: la misma que usa Flutter para el resto de la API, sin hardcodear un dominio nuevo. Headers comunes:

```http
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

### Registrar o actualizar

```http
POST /api/push/devices
```

```json
{
  "token": "TOKEN_FCM_OBTENIDO_DEL_SDK",
  "platform": "android",
  "installationId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902"
}
```

`platform` admite `android`, `ios` y `web`. El token es un string de 20 a 4096 caracteres sin espacios. En móvil puede omitirse `installationId` porque se toma de la sesión; si se envía debe coincidir. Recomiendo enviarlo explícitamente para detectar inconsistencias locales.

El backend toma usuario y sesión del JWT. No enviar `userId` ni `sessionId`. Responde **200** tanto al crear como al repetir o actualizar:

```json
{
  "device": {
    "id": "6e3f5a6b-c1d2-4a33-91f0-0b8838ab9c12",
    "platform": "android",
    "installationId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902",
    "enabled": true,
    "lastSeenAt": "2026-10-27T20:00:00.000Z",
    "createdAt": "2026-10-27T20:00:00.000Z",
    "updatedAt": "2026-10-27T20:00:00.000Z"
  }
}
```

El `device.id` de esta respuesta es un ID de registro del backend, distinto del UUID de instalación. No devuelve el token. Repetir la misma instalación actualiza su registro; un token nuevo reemplaza al anterior. Si el mismo token se registra desde otra cuenta autenticada, su asociación anterior se desactiva. Las entregas pendientes del registro anterior no se transfieren al nuevo usuario.

### Desvincular

```http
DELETE /api/push/devices
```

```json
{ "installationId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902" }
```

Respuesta **204 sin body**. También acepta `{ "token": "TOKEN_FCM" }`; si se envían ambos, ambos deben coincidir. Para una sesión móvil completa se admite `{}` y se usa la instalación de esa sesión.

Llamar antes de cerrar la sesión o cambiar de cuenta. No intentar deserializar JSON de la respuesta 204. La baja es idempotente y restringida al usuario/sesión actual. Si no hay red, cerrar localmente de forma segura y revocar la sesión cuando corresponda; no reenviar una baja de la cuenta anterior usando las credenciales de la cuenta nueva. La revocación/expiración de sesión también impide envíos desde el backend. Un mensaje ya aceptado por FCM puede llegar después de logout.

### Consultar metadatos propios

```http
GET /api/push/devices
```

Devuelve `{ "devices": [...] }`, incluidos registros deshabilitados; nunca tokens completos. Es una herramienta de diagnóstico, no una condición necesaria para cada recepción.

### Errores

| Estado | Comportamiento Flutter |
| --- | --- |
| 400 | Corregir plataforma, token o instalación; no reintentar sin cambios |
| 401 | Usar el flujo existente de renovación una sola vez si procede; sesión revocada o `OTP_REQUIRED` requiere OTP |
| 403 | Respetar restricciones de cuenta/política; no intentar eludirlas |
| 429 | Respetar `Retry-After` y espaciar sincronizaciones |
| 503 / fallo de red | Guardar sincronización pendiente con reintentos acotados; no bloquear la app |

Registro, consulta y baja: 30 solicitudes por minuto por usuario. Los reportes nuevos de presencia y presentación tienen límites independientes descritos en la guía del respaldo. Las renovaciones de refresh deben seguir serializadas por el gestor de autenticación existente.

## Ciclo de vida a implementar en Flutter

1. Inicializar Firebase y los listeners una vez. Solicitar permisos con contexto de UI; rechazar permiso no debe impedir pedir o prestar un viaje.
2. Tras login OTP o restauración válida, obtener el token FCM y sincronizarlo con POST. Si aún no hay token o red, marcar pendiente.
3. Escuchar cambios de token (`onTokenRefresh` según la versión FlutterFire elegida), conservar el más reciente y sincronizar solo si existe sesión completa.
4. En reanudación/reconexión, reintentar una sincronización pendiente. No registrar repetidamente en cada evento Socket.IO ni crear listeners duplicados.
5. Serializar actualizaciones de registro para evitar que un token antiguo llegue después del nuevo. Asociar tareas a la cuenta/sesión de origen y cancelar o descartar respuestas de tareas obsoletas tras un cambio de cuenta.
6. Antes de logout, DELETE y luego el cierre de autenticación habitual. En el nuevo login, registrar nuevamente incluso si FCM conserva el mismo token.
7. Si el usuario desactiva notificaciones desde la app, desvincular el dispositivo y respetar esa preferencia al sincronizar. No existe un endpoint de preferencias push/marketing independiente en esta entrega.

Android e iOS requieren configuración de plataforma y permisos. En iOS, preparar APNs y esperar disponibilidad de su token antes de operaciones FCM que lo necesiten. En Android, preparar canal y política de presentación/sonido. Web/PWA requiere configuración web, HTTPS, VAPID y service worker; su implementación no viene incluida en el backend. Consultar las [instrucciones oficiales de configuración Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/get-started).

## Contrato de mensajes

El backend envía **`notification + data`**. `notification.title` y `notification.body` contienen el texto visible. Todos los valores de `data` son strings. Ejemplos ilustrativos; los UUID reales los genera el backend.

Invitación:

```json
{
  "notification": {
    "title": "Nueva solicitud de viaje",
    "body": "Hay un servicio disponible. Abre la app para consultar la invitación."
  },
  "data": {
    "eventId": "invite:UUID_INVITACION:2026-10-27T20:00:00.000Z",
    "type": "ride.invite",
    "schemaVersion": "1",
    "expiresAt": "2026-10-27T20:01:00.000Z",
    "rideId": "UUID_VIAJE",
    "inviteId": "UUID_INVITACION",
    "invitedAt": "2026-10-27T20:00:00.000Z"
  }
}
```

Cambio de estado:

```json
{
  "notification": {
    "title": "Conductor asignado",
    "body": "Un conductor aceptó tu viaje."
  },
  "data": {
    "eventId": "ride:UUID_EVENTO",
    "type": "ride.status",
    "schemaVersion": "1",
    "expiresAt": "2026-10-27T20:05:00.000Z",
    "rideId": "UUID_VIAJE",
    "sourceEventId": "UUID_EVENTO",
    "status": "driver_assigned"
  }
}
```

No hay `route`, `click_action`, dirección completa, conductor completo ni objeto `ride` dentro del payload. Flutter resuelve navegación usando `type` e identificadores y consulta la API. No requiere esos campos adicionales para funcionar.

| Tipo / estado | Destino actual del backend | Vigencia de transporte |
| --- | --- | --- |
| `ride.invite` | Conductor invitado y todavía elegible | 60 s por defecto, configurable de 1 a 90 s |
| `ride.status`: `driver_assigned`, `driver_en_route`, `driver_arrived`, `in_progress` | Pasajero, excluido el actor | 5 min |
| `ride.status`: `completed` | Pasajero, excluido el actor | 1 h |
| `ride.status`: `canceled_by_client`, `canceled_by_driver`, `canceled_by_system` | Pasajero/conductor asociados, excluido el actor | 5 min |
| `driver.panic` | Admin/operator; no al conductor que activó pánico | 5 min |
| `message.important` | Solo cuando código interno del backend lo solicita | Definida por el emisor, máximo 1 h |

`driver.panic` incluye `notificationId` y un `eventId` con prefijo `panic:`. `message.important` está soportado por el servicio interno, pero no tiene un disparador automático ni endpoint público para enviar mensajes arbitrarios. Un tipo o versión desconocidos deben ignorarse de forma segura, sin navegación inventada.

La vigencia de transporte no redefine el plazo de aceptación del negocio. Un evento puede llegar duplicado, atrasado o fuera de orden. El backend revalida estado/sesión antes de enviar, pero un cambio posterior o las restricciones del sistema operativo pueden afectar la entrega.

## Recepción, visualización y navegación

- Primer plano: `FirebaseMessaging.onMessage`; actualizar estado mediante la misma capa de sincronización usada por Socket.IO. Elegir banner dentro de la app o presentación local según la UX.
- Segundo plano: handler de background de FlutterFire con función top-level y anotación requerida por release; no navegar ni acceder directamente a UI desde ese handler.
- Pulsación con app en segundo plano: `onMessageOpenedApp`.
- Pulsación que arranca la app: `getInitialMessage`, esperar inicialización del router y restauración/autenticación antes de navegar.

Estas APIs y los requisitos del handler están descritos en [recepción oficial de mensajes Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages). Ajustar los detalles a la versión del SDK usada por la app.

Evitar doble presentación: en background el mensaje contiene `notification` y el sistema puede mostrarlo; no mostrar además una copia local. En iOS foreground, si se habilita presentación del sistema, coordinarla con la presentación local. Con Socket.IO y FCM, compartir la actualización del recurso y deduplicar los avisos visibles cuando haya identidad de evento disponible.

Usar `eventId` para deduplicación; no asumir equivalencia entre `RemoteMessage.messageId` y `sourceEventId`. Separar deduplicación de presentación y de navegación: haber mostrado un evento no debe impedir abrirlo al pulsarlo después.

Flujo de apertura:

1. Validar `schemaVersion`, `type`, IDs y fecha sin confiar en datos arbitrarios para ejecutar acciones.
2. Esperar la sesión y el router. Conservar solo el destino mínimo pendiente si hace falta autenticación.
3. Consultar `GET /api/rides/:rideId`. Para conductor, sincronizar además sus invitaciones mediante `GET /api/rides/driver-invites`.
4. Si el recurso no pertenece a la cuenta actual o devuelve 403/404, no mostrar datos cacheados de otra cuenta; usar una salida segura.
5. Si es invitación, habilitar aceptar/rechazar únicamente con estado vigente confirmado por API. Si venció `expiresAt`, refrescar el recurso, pero no presentar el payload antiguo como una oferta válida.
6. Para aceptar/rechazar usar el flujo HTTP existente `PATCH /api/rides/:rideId/driver-response`; nunca aceptar automáticamente por recibir un push.

No se incluye `userId` del destinatario en `data`. Después de cambiar cuenta, la comprobación de acceso por API y el aislamiento de cachés por usuario son obligatorios para no abrir datos anteriores.

## Criterios de aceptación para Flutter

- Registro al iniciar sesión y restaurar; rotación sincronizada sin carreras ni listeners duplicados.
- Recibir en Android/iOS reales en foreground, background y apertura desde estado terminado.
- Permisos rechazados, token ausente y falta de red no bloquean el flujo del taxi.
- Un aviso visible por evento; pulsarlo sigue navegando aunque ya se hubiera mostrado.
- Una invitación aceptada por otro conductor, vencida o de un viaje cancelado nunca habilita aceptación por un payload antiguo.
- Logout, sesión revocada, reinstalación y cambio de cuenta no reutilizan credenciales o datos de otra instalación/cuenta.
- Datos de prueba en payloads y logs sin tokens FCM completos, JWT, OTP ni información privada innecesaria.
- Prueba de varias instalaciones por usuario: cerrar una sesión no debe dar de baja las otras.
- Reconciliar viajes/invitaciones al reconectar aunque no llegue ninguna notificación. El backend encola después del commit y existe una ventana de pérdida si cae antes del encolado; FCM tampoco garantiza entrega oportuna.

## Información que debe recibir el equipo móvil

Confirmar URL de staging/producción, aplicaciones Firebase registradas para cada package/bundle, configuración Firebase cliente y APNs/VAPID según plataformas. El backend ya tiene contrato y pruebas, pero la recepción extremo a extremo requiere despliegue y clientes configurados. No se debe entregar la clave privada de Firebase Admin al equipo móvil para incluirla en la app.
