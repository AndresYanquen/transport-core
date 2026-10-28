# Firebase Cloud Messaging en el backend de gotTaxi

## Actualización de invitaciones

Se implementó Socket.IO primero y FCM como respaldo con confirmación por instalación, presencia con caducidad y arbitraje atómico ACK/despacho. Requiere también `20261030_add_push_invitation_fallback.js`. Contratos y activación: [guía del respaldo](push-socket-fallback.md). Esta sección amplía el contrato inicial descrito abajo.

## Arquitectura y alcance

Requiere Node.js 22 o posterior, compatible con el Dockerfile existente. Se integra Firebase Admin SDK con el proyecto existente `gottaxi-191c2`. No se usa Firebase Authentication, Firestore ni se cambia el matching, PostgreSQL, Socket.IO o LiveKit. Flutter y Vue no se modifican en esta entrega. La API admite Android, iOS y web, pero cada cliente debe configurar sus permisos y recepción de mensajes.

Flujo: operación de negocio → commit PostgreSQL → encolado best effort en `push_deliveries` → worker → Firebase HTTP v1 mediante Admin SDK. El encolado usa los puntos posteriores al commit de `ride.service.js` y la creación persistida de alertas de pánico. Nunca se llama a Firebase dentro de una transacción de viajes.

La cola persiste una entrega por evento/usuario/dispositivo, sin duplicados al repetir el mismo evento. Se conserva el identificador del evento real de viaje; las invitaciones incluyen ID y `invitedAt`, porque la tabla `ride_driver_invites` puede reutilizar una fila en nuevas invitaciones. Cada entrega está vinculada a una versión de registro: una rotación de token o cambio de cuenta invalida el trabajo antiguo.

El worker empieza en `src/server.js`, reclama lotes mediante `FOR UPDATE SKIP LOCKED` y leases de cinco minutos; varios procesos pueden compartir la cola. Cada recuperación genera un nuevo `lease_id` para impedir que un worker antiguo cierre una entrega recuperada por otro. Al apagar, deja de iniciar lotes y espera el lote actual, sujeto al timeout global de cierre del servidor.

Estados: `pending`, `processing`, `accepted`, `discarded`, `failed` y `suppressed` (presentación confirmada antes del despacho). `accepted` significa que FCM aceptó el mensaje, no entrega al teléfono ni lectura. La entrega es al menos una vez y puede duplicarse si el proceso cae después de enviar y antes de guardar la respuesta. El cliente debe deduplicar mediante `eventId` y consultar siempre el recurso por API.

## Migración

`migrations/20261029_create_push_devices_and_deliveries.js` crea:

- `user_push_devices`: propietario, token único anulable, instalación UUID, plataforma, sesión móvil, versión de seguridad, vencimiento de autorización administrativa, versión de registro y fechas. Desactivar borra el token.
- `push_deliveries`: evento, usuario, dispositivo, versión del registro, payload mínimo, vigencia, intentos, lease, resultado e identificador FCM. No copia tokens en la cola.

Requiere las migraciones previas de sesiones móviles y `security_version`. Ejecutar `npm run migrate:latest` en el entorno elegido antes de habilitar el canal. No se han ejecutado migraciones contra tablas de producción como parte de esta implementación.

## Configuración de Firebase y Coolify

Ejemplo completo sin secretos: `.env.firebase-push.example`. También se amplían `.env.example` y `.env.coolify.example`.

| Variable | Valor por defecto | Uso |
| --- | --- | --- |
| `PUSH_ENABLED` | `false` | Habilita encolado y worker; no afecta la API de registro |
| `FIREBASE_PROJECT_ID` | `gottaxi-191c2` | Proyecto al que se envía |
| `GOOGLE_APPLICATION_CREDENTIALS` | vacío | Ruta absoluta a JSON de cuenta de servicio dentro del contenedor |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | vacío | Alternativa: JSON completo como secreto de entorno |
| `PUSH_WORKER_INTERVAL_MS` | `500` | Intervalo entre 100 y 60000 ms |
| `PUSH_INVITATION_ACK_WAIT_MS` | `2000` | Espera inicial de confirmación, entre 0 y 10000 ms |
| `PUSH_VISIBILITY_TTL_SECONDS` | `40` | Vigencia del reporte de visibilidad, entre 10 y 120 s |
| `PUSH_BATCH_SIZE` | `50` | Entre 1 y 500 mensajes por llamada `sendEach` |
| `PUSH_MAX_ATTEMPTS` | `3` | Entre 1 y 10 intentos de aplicación |
| `PUSH_INVITE_TTL_SECONDS` | `60` | Vigencia de transporte, entre 1 y 90 segundos; no cambia la expiración de negocio |
| `PUSH_RETENTION_DAYS` | `30` | Retención mínima de resultados terminales |

1. En el proyecto existente, comprobar que Firebase Cloud Messaging API está habilitada y crear o seleccionar una cuenta de servicio con permisos de envío de FCM. No usar una clave del SDK web como credencial del servidor.
2. En Coolify, montar el archivo de cuenta de servicio como secreto de solo lectura, por ejemplo `/run/secrets/gottaxi-firebase-admin.json`. Configurar esa ruta como `GOOGLE_APPLICATION_CREDENTIALS`. El archivo debe estar dentro del contenedor en ejecución, no solo en el host.
3. Alternativamente, configurar `FIREBASE_SERVICE_ACCOUNT_JSON` como secreto con el JSON completo. No definir ambas opciones. Los saltos de línea de `private_key` son escapes `\n` dentro del JSON; no pegar una clave en archivos versionados.
4. Si no se define ninguna opción se usan Application Default Credentials del entorno. En un VPS común no hay identidad Google automática: configurar el secreto explícito. La inicialización valida localmente la estructura y proyecto de archivos/JSON; la autorización remota de ADC/FCM se comprueba al enviar.
5. Inicialmente mantener `PUSH_ENABLED=false`; aplicar migraciones, configurar clientes y luego habilitar en staging. Firebase se inicializa una sola vez. Configuración inválida registra `push_unavailable` sin detalles secretos y deja funcionando el backend. Corregir secretos requiere reiniciar el proceso.

No añadir estas variables como `VITE_*`, argumentos públicos de build ni archivos dentro de `client/`. `.gitignore` y `.dockerignore` excluyen `.secrets/` y nombres habituales de cuentas de servicio; mantener cualquier otro nombre de archivo secreto fuera del repositorio/contexto Docker.

## API para Flutter

Todas las rutas requieren `Authorization: Bearer <access token>`. Se reutiliza el middleware JWT: cuenta activa, versión de credenciales vigente y sesión móvil activa. Tokens de inscripción Google/correo sin sesión OTP no habilitan el registro móvil. Registro, consulta y baja tienen límite de 30 peticiones/minuto por usuario, con store Redis si está configurado, o por proceso si no lo está. Las nuevas rutas de presencia/confirmación tienen límites independientes descritos en la guía del respaldo.

### POST /api/push/devices

```json
{
  "token": "FCM_DEVICE_TOKEN_OBTENIDO_DEL_SDK",
  "platform": "android",
  "installationId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902"
}
```

`platform`: `android`, `ios` o `web`. Token: string sin espacios, de 20 a 4096 caracteres. En sesiones móviles, `installationId` se toma de la sesión del JWT; si se envía debe coincidir. Una app Flutter web con sesión OTP usa la misma vinculación por instalación y `platform=web`. Admin/operator sin `sid` solo pueden registrar web y deben proporcionar UUID propio de instalación. Su autorización push vence con el JWT de registro y debe renovarse al restaurar o renovar el acceso.

Respuesta 200, también para actualizaciones idempotentes:

```json
{
  "device": {
    "id": "UUID",
    "platform": "android",
    "installationId": "UUID",
    "enabled": true,
    "lastSeenAt": "2026-10-27T20:00:00.000Z",
    "createdAt": "2026-10-27T20:00:00.000Z",
    "updatedAt": "2026-10-27T20:00:00.000Z"
  }
}
```

No enviar `userId` ni `sessionId`: el backend usa exclusivamente la identidad validada. Registrar nuevamente la misma instalación sustituye el token anterior. Presentar el mismo token desde otra cuenta autenticada desvincula su asociación anterior antes de vincularlo al usuario actual, dentro de una transacción serializada. Como en el registro FCM habitual, esto presupone que el cliente conserva el token como dato privado; conocer un UUID de instalación no autoriza a apropiarse de un token ajeno.

### DELETE /api/push/devices

```json
{ "installationId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902" }
```

También acepta `{ "token": "FCM_DEVICE_TOKEN_OBTENIDO_DEL_SDK" }`; si se envían ambos, ambos deben coincidir. En móvil la instalación se deriva de la sesión y se puede enviar `{}`. Respuesta 204, exista o no un registro coincidente. El UPDATE siempre restringe usuario y sesión; no puede dar de baja dispositivos de otras cuentas o sesiones móviles. Admin/operator web requieren un token o una instalación explícita.

Llamar antes de borrar las credenciales al cerrar/cambiar cuenta. En móviles, revocación, reemplazo o expiración de la sesión impiden enviar aunque falle esta baja; el worker comprueba sesión y limpia asociaciones inválidas. En web sin sesiones móviles, cerrar el almacenamiento local no es una señal al servidor: el cliente debe invocar DELETE; de otro modo el registro sigue válido hasta que vence su JWT o cambia la versión de seguridad de la cuenta.

### GET /api/push/devices

Devuelve `{ "devices": [...] }` con los mismos metadatos públicos, solo del usuario autenticado, incluidos registros deshabilitados. No devuelve tokens, versiones internas ni credenciales.

Errores: 400 entrada inválida, 401 autenticación/sesión inválida, 403 política/cuenta no autorizada, 429 rate limit y 503 fallo de persistencia. Errores de SQL/FCM no se devuelven al cliente con sus detalles.

## Eventos implementados

| Evento | Destinatario | Vigencia máxima |
| --- | --- | --- |
| Invitación creada | Conductor que ya seleccionó el matching | 60 s configurable |
| `driver_assigned` | Pasajero | 5 min |
| `driver_en_route` | Pasajero | 5 min |
| `driver_arrived` | Pasajero | 5 min |
| `in_progress` | Pasajero | 5 min |
| `completed` | Pasajero | 1 h |
| `canceled_by_client`, `canceled_by_driver`, `canceled_by_system` | Pasajero y conductor asociados, excluido el actor | 5 min |
| Pánico nuevo | Admin/operator activos | 5 min |

Al enviar invitaciones se revalida fila real pendiente y fecha de invitación, viaje en `pending_driver` sin conductor asignado, aprobación, disponibilidad, presencia reciente, servicio activo y ausencia de otro viaje activo. Si cambia cualquiera, se descarta el aviso; no se reasigna ni se altera el matching.

Estados de viaje se revalidan contra `rides` y `ride_events`, incluyendo pertenencia del destinatario. Pánico se descarta cuando deja de estar sin leer. Una revalidación no evita un cambio de estado que suceda inmediatamente después: la app debe refrescar por HTTP al abrir.

`push.service.js` expone `sendToUser`, `sendToUsers` y `sendToDevice`: encolan y devuelven `{queued}`; no envían síncronamente. Existe `message.important` para código interno confiable, sin trigger automático ni endpoint de envío arbitrario. No se ha añadido marketing ni difusión por topics públicos. `push-device.model.js` expone desactivación de tokens inválidos con control de versión.

## Payload y clientes

Ejemplo enviado a FCM:

```json
{
  "notification": {
    "title": "Conductor asignado",
    "body": "Un conductor aceptó tu viaje."
  },
  "data": {
    "eventId": "ride:UUID_DEL_EVENTO",
    "type": "ride.status",
    "schemaVersion": "1",
    "rideId": "UUID_DEL_VIAJE",
    "sourceEventId": "UUID_DEL_EVENTO",
    "status": "driver_assigned",
    "expiresAt": "2026-10-27T20:05:00.000Z"
  }
}
```

Invitación añade `inviteId` e `invitedAt`; pánico usa `notificationId`. Todos los valores `data` son strings. Android, APNs y web reciben vigencia de transporte; invitaciones/pánico usan prioridad alta. No se incluyen JWT, OTP, teléfonos, coordenadas, direcciones completas ni datos de pago.

Flutter debe configurar Firebase, APNs en iOS, permisos y canales Android, registrar al iniciar/restaurar sesión y en `onTokenRefresh`, y manejar foreground, background y apertura desde estado terminado. Los mensajes incluyen `notification + data`: evitar mostrar además otra notificación local en background. Al abrir, validar sesión y consultar API para navegar; no aceptar servicios desde un payload. Web requiere HTTPS, permiso, VAPID y service worker del lado cliente; esta entrega prepara únicamente el backend.

## Fallos, observabilidad y límites

Errores transitorios se reintentan con backoff de al menos 60 segundos, crecimiento exponencial, jitter y `Retry-After` cuando el SDK lo expone. Se respetan vigencia e intentos máximos. Para una invitación de 60 s, un fallo normalmente será terminal porque ya no queda tiempo para un reintento útil. Un fallo parcial solo reintenta dispositivos afectados.

Se desactivan únicamente `registration-token-not-registered` e `invalid-registration-token`. `invalid-argument` no desactiva: puede ser un payload inválido. Fallos de credenciales o payload son terminales y quedan en `last_error`; no se reintentan indefinidamente. Errores desconocidos se guardan como `provider-error`, sin mensaje libre del proveedor.

Logs estructurados: `push_initialized`, `push_unavailable`, `push_enqueue_failed`, `push_event_enqueue_failed`, `push_delivery_error`, `push_worker_failed`, `push_batch_completed`. Contadores por proceso: aceptados, fallidos, reintentados y descartados, acumulados en los logs de lotes. Para backlog consultar `push_deliveries` por estado/antigüedad; no hay endpoint público de métricas ni panel de reenvío. La limpieza elimina hasta 1000 resultados terminales por minuto tras su retención.

Límites conocidos:

- El encolado ocurre después del commit para mantener aislada la lógica existente. Una caída en esa ventana o un error de persistencia puede perder el aviso; se registra el fallo y la API/Socket.IO siguen siendo el mecanismo de sincronización. No se implementa una outbox transaccional con el cambio de negocio ni recuperación histórica de esa ventana.
- La deduplicación dura mientras existe el registro de entrega (retención configurable); no se promete entrega exactamente una vez.
- Registro de token presume posesión por el cliente autenticado; no implementa atestación del dispositivo.
- No se puede retirar un mensaje ya aceptado por FCM tras logout ni garantizar entrega inmediata ante restricciones de iOS/Android, batería o navegador cerrado.
- Una rotación de token descarta avisos pendientes del registro anterior; el cliente debe sincronizar recursos al reconectar.
- La inicialización no verifica por red permisos IAM/APNs ni entrega real; deben comprobarse en staging con los clientes.

## Validación y operación manual

Pruebas unitarias: `node --test tests/push.service.test.js tests/firebase.config.test.js`. Suite general: `npm test`. Integración opt-in: `npm run test:push:integration`, utilizando exclusivamente una base local/de pruebas. Crea esquema aleatorio, ejecuta migraciones allí y lo elimina al terminar. No usa Firebase real. Incluye persistencia, rotación, cambio de propietario, unicidad concurrente, aislamiento, JWT, sesión revocada, deduplicación, leases y envío simulado.

Prueba manual en staging:

1. Aplicar migraciones y configurar secreto Firebase del proyecto correcto; habilitar push.
2. Autenticar dos cuentas en dispositivos de prueba; registrar tokens reales obtenidos por los SDK de cliente.
3. Crear un viaje desde una cuenta de prueba y generar una invitación por el matching normal. Verificar Socket.IO, fila de entrega y aviso en el teléfono del conductor elegible.
4. Aceptar, avanzar estados y cancelar; comprobar destino, actor excluido y descarte de mensajes atrasados. El payload no debe mostrar datos privados.
5. Probar background/foreground, permiso rechazado, token rotado, cierre/revocación de sesión y cambio de cuenta. Un token de otra cuenta no debe recibir eventos anteriores.
6. Activar pánico en prueba y comprobar la cola operativa y aviso a admin/operator. No confundir aceptación FCM con atención del incidente.
7. Con proveedor inhabilitado o secreto inválido, verificar que crear/aceptar viajes sigue funcionando y aparece el diagnóstico sanitizado. Restaurar configuración y revisar vencimientos antes de reactivar.

## Despliegue y rollback

No hay despliegue automático. Revisar cambios, ejecutar pruebas, respaldar según el procedimiento habitual y aplicar migraciones en el entorno autorizado. Publicar imagen, montar secretos y mantener push desactivado hasta tener los clientes listos. Habilitar primero staging y observar cola, errores y tiempos. Coolify debe conservar PostgreSQL y secretos al recrear contenedores.

Rollback operativo: establecer `PUSH_ENABLED=false` y reiniciar, manteniendo tablas para auditoría. Trabajos pendientes vencidos se descartan al volver a activar. Para retirar esquema, detener todas las versiones que usan push y revertir específicamente la migración `20261029_create_push_devices_and_deliveries.js` mediante el procedimiento de Knex del proyecto; esto elimina dispositivos e historial. No ejecutar un rollback genérico a ciegas si ya hay migraciones posteriores.

## Referencias oficiales

- [Configuración Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Envíos por Admin SDK](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)
- [Códigos de error](https://firebase.google.com/docs/cloud-messaging/error-codes)
- [Configuración Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/get-started)

## Archivos de la entrega y resultados

Creados:

- `src/config/firebase.js`: inicialización única y configuración sanitizada.
- `src/modules/push/models/push-device.model.js`: persistencia, rotación y baja de registros.
- `src/modules/push/models/push-delivery.model.js`: cola, leases y revalidación de recursos.
- `src/modules/push/services/push-device.service.js`: validación y vinculación con JWT/sesión.
- `src/modules/push/services/push.service.js`: interfaz interna de encolado y payload permitido.
- `src/modules/push/services/push-events.service.js`: traducción de eventos de negocio.
- `src/modules/push/services/push.worker.js`: envío, clasificación de errores, reintentos y limpieza.
- `src/modules/push/controllers/push-device.controller.js` y `routes/push.routes.js`: API y rate limit.
- `migrations/20261029_create_push_devices_and_deliveries.js`.
- `tests/push.service.test.js`, `tests/firebase.config.test.js`, `tests/push.integration.test.js`.
- `.env.firebase-push.example` y este documento.

Modificados: `package.json`, `package-lock.json`, `src/config/env.js`, `src/app.js`, `src/server.js`, `src/modules/rides/services/ride.service.js`, `src/modules/driver-notifications/services/driver-notification.service.js`, `.env.example`, `.env.coolify.example`, `.gitignore`, `.dockerignore` y `README.md`. Se conserva el plan previo `docs/firebase-push-plan.md` como referencia; este documento describe la implementación efectiva y sus diferencias.

Resultados de esta entrega:

- `npm test`: 220 pruebas correctas, cero fallos, tres suites opt-in de base de datos omitidas.
- Suite push específica: 17 pruebas unitarias correctas, incluidas cuatro de configuración Firebase con inicialización local del SDK, sin envíos reales.
- `npm run test:push:integration`: 12 escenarios correctos (13 pruebas incluyendo el contenedor del runner), esquema temporal local eliminado al finalizar.
- Verificación de diff sin errores de whitespace.
- La auditoría inicial identificó 11 avisos preexistentes. Posteriormente se corrigió el crítico de `proxy-addr` actualizando exclusivamente esa dependencia transitiva de Express de `2.0.7` a `2.0.8` en `package-lock.json`. La auditoría posterior informa cero críticos y diez avisos restantes (ocho altos y dos moderados), sin aviso para `proxy-addr`. No se identificaron avisos nuevos en las dependencias añadidas por Firebase en ese informe. Las otras actualizaciones quedan pendientes.

Pendiente manual: montar credencial del proyecto existente, aplicar migración en el entorno autorizado, preparar SDK/permisos/APNs/VAPID en clientes externos a esta entrega, habilitar push y realizar validación real en staging. No se desplegó, no se modificaron credenciales reales y no se realizaron envíos FCM reales.

## Corrección de seguridad de proxy-addr

Se actualizó `proxy-addr` a `2.0.8`, versión corregida según el [aviso oficial GHSA-jqcg-44mw-7w3h](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h). Express conserva su versión y la configuración actual de `trust proxy` no cambia. El lockfile instala la versión corregida mediante `npm ci`, también en la construcción Docker.

`tests/proxy-trust.security.test.js` comprueba la dependencia que resuelve Express: un rango IPv6 mapeado con prefijo corto o un rango IPv6 nativo no debe confiar en un peer IPv4 externo ni permitir que controle la IP mediante `X-Forwarded-For`; los rangos IPv4 y mapeados válidos siguen resolviendo el cliente esperado.

Verificación posterior: `npm test` pasó con 223 pruebas correctas, cero fallos y tres suites de integración opt-in omitidas. `npm audit` devolvió cero vulnerabilidades críticas y ninguna para `proxy-addr` (continúa devolviendo código 1 por los otros diez avisos). Para aplicar la corrección en producción hace falta reconstruir y desplegar la imagen con el lockfile actualizado; no se realizó ese despliegue automáticamente.
