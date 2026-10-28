# Plan de implementación de notificaciones push con Firebase

## Alcance y diagnóstico

Revisión del repositorio realizada el 27 de octubre de 2026. Este documento es un plan; no incorpora dependencias, migraciones ni envíos reales.

- Backend Express 5/CommonJS, PostgreSQL con migraciones Knex y consultas mediante `pg`. Socket.IO tiene adaptador Redis; Redis no constituye hoy una cola persistente de push.
- `src/modules/rides/services/ride.service.js` emite `ride:invite-created`, `ride:status-updated` y eventos operativos. Tiene transacciones y protección de concurrencia que deben conservarse.
- `src/modules/driver-notifications/` persiste alertas de pánico y sus estados de atención. Emite a operadores y administradores; no es una bandeja genérica de notificaciones de todos los usuarios.
- `client/` es el panel Vue 3/Vite. `client/src/stores/driverNotifications.js` escucha alertas por Socket.IO. No hay SDK Firebase ni service worker de mensajería en el código revisado.
- `docs/mobile-sessions.md` define sesiones Flutter por instalación, JWT con `sid`, renovación y revocación. El cliente Flutter no está en este repositorio: su implementación requiere trabajar en su repositorio.
- `src/server.js` inicia workers de presencia y radio y gestiona el cierre ordenado. Es el punto para integrar inicialmente el worker push, con opción posterior de ejecutarlo por separado.

Recomendación: mantener Socket.IO para la operación en vivo y añadir FCM como canal de aviso. HTTP y PostgreSQL siguen determinando el estado y autorizando las acciones. No usar push para posiciones GPS, audio ni cada actualización del mapa.

## 1. Configuración y contrato de eventos

Preparar proyectos Firebase separados para pruebas y producción, registrar aplicaciones Android/iOS y, si se habilita el panel, una aplicación web. Identificar package name y bundle ID del cliente Flutter. Configurar credenciales APNs para iOS y claves VAPID para web.

Añadir `firebase-admin` al backend e inicialización única en `src/config/firebase.js`. Usar credenciales de servidor mediante identidad del entorno o archivo secreto montado, nunca dentro de `client/`, Git o la imagen Docker. Documentar `PUSH_ENABLED`, proyecto, ubicación de credenciales y parámetros del worker en `src/config/env.js`, `.env.example`, `.env.coolify.example` y `docs/deployment.md`. Definir validación estricta de configuración cuando push esté habilitado; permitir mantenerlo deshabilitado.

Establecer esta matriz inicial, ajustable antes de activar cada evento:

| Evento de negocio | Destinatarios | Vigencia propuesta |
| --- | --- | --- |
| Invitación de viaje creada | Conductores invitados con sesión activa y elegibilidad vigente | Hasta la expiración real de la invitación; no inventar un TTL independiente |
| Conductor asignado, en camino o llegado | Pasajero del viaje | Ventana corta por estado; descartar si ya cambió |
| Viaje cancelado | Contraparte afectada | Cinco minutos, revalidando estado |
| Viaje completado | Pasajero, para consultar resumen | Una hora |
| Pánico creado | Operadores y administradores habilitados | Cinco minutos y solo mientras siga sin atención |

No avisar al actor de su propia acción salvo una necesidad explícita. Resolver destinatarios en servidor y enviar a instalaciones concretas; evitar topics públicos por rol para información privada. Pánico sigue en la cola operativa existente y requiere atención humana: aceptación por FCM no acredita entrega ni atención.

Contrato versionado de payload: `eventId`, `type`, `entityId`, `occurredAt`, `expiresAt` y `schemaVersion`; añadir `rideId` o `notificationId` según el caso. Los valores de `data` deben serializarse como strings. Título y cuerpo mínimos, sin teléfono, coordenadas precisas, credenciales ni direcciones completas en pantalla bloqueada. Al abrir, autenticar y consultar la entidad por API; no ejecutar aceptación de viajes desde el payload.

## 2. Registro de instalaciones y tokens

Crear módulo `src/modules/push/` siguiendo la organización de rutas, controladores, servicios y modelos existente. Montar rutas autenticadas en `src/app.js`.

Migración propuesta `push_installations`: ID, `user_id`, `installation_id`, `session_id` móvil, plataforma, token FCM, hash del token para identificación sin exposición, proyecto/aplicación, permiso declarado, fechas de registro/última sincronización y revocación. El token debe poder recuperarse para enviar; el hash por sí solo no sirve. Añadir índices por usuario/sesión e impedir múltiples asociaciones activas del mismo token dentro de la misma aplicación/proyecto.

- `PUT /api/push/installations/:installationId`: alta/actualización idempotente del token de la instalación propia.
- `DELETE /api/push/installations/:installationId`: baja idempotente de la instalación propia.
- Validar tamaño, plataforma, formato de instalación, propietario y límites de frecuencia. Tomar usuario y `sid` del JWT validado, nunca confiar en un `userId` o `sessionId` enviado en el body.
- Para Flutter, comprobar que la instalación coincide con la sesión activa; rechazar accesos de inscripción sin sesión completa. No modificar el contrato OTP ni convertir el token FCM en autenticación.
- Para Vue, permitir registro únicamente a admin/operator autenticados. Como hoy usa JWT sin sesión móvil y su logout solo limpia almacenamiento local, definir baja del registro web antes de limpiar sesión, vencimiento de su autorización y limpieza de registros abandonados. No exigir `auth_mobile_sessions` al panel.
- Al rotar token, sustituir el anterior de forma atómica. Resolver cambio de cuenta en el mismo navegador/dispositivo sin permitir que la asociación antigua siga recibiendo eventos. Los IDs declarados por el cliente no prueban propiedad de otra sesión.
- Integrar cierre individual/global, reemplazo de sesión, reutilización de refresh token, cambio de contraseña y expiración con los flujos reales de revocación. Además de marcar bajas, revalidar sesión/usuario antes de enviar. Un push ya aceptado por el proveedor no puede retirarse con esta operación.

## 3. Entrega durable y worker

Crear una outbox PostgreSQL y registros de entrega por instalación. Guardar evento y trabajo push en la misma transacción del cambio de negocio. Emitir Socket.IO después del commit como hoy; el worker llama a Firebase fuera de esa transacción. No basta con añadir un envío a `emitToUser`: habría pérdida de avisos si el proceso cae entre el commit y el envío.

En viajes, revisar todos los caminos que crean invitaciones o cambian estado: asignación, aceptación, cancelación, reencolado y timeouts. En pánico, permitir que `DriverNotificationModel.create` y la inserción de outbox compartan transacción; conservar el cooldown y no duplicar eventos cuando devuelve una alerta existente.

Campos de trabajo: evento, destinatario, instalación, estado, intentos, próxima ejecución, vencimiento, bloqueo temporal, último código de error e ID devuelto por FCM. Clave única por evento/instalación; un fallo de un dispositivo no debe reenviar a los que ya aceptó FCM.

Worker con lotes limitados, reclamación mediante `FOR UPDATE SKIP LOCKED`, lease recuperable tras caídas y exclusión entre procesos. Estados propuestos: pendiente, procesando, aceptado por FCM, descartado y fallido definitivo. Recuperar leases vencidos y cerrar ordenadamente junto con el servidor. Mantener límites de intentos, retención y concurrencia configurables.

Antes de enviar, comprobar autorización vigente, estado del viaje/invitación/pánico y vencimiento. Aplicar TTL por plataforma a la vigencia restante. Reintentar errores temporales con backoff y jitter, respetando `Retry-After` cuando esté disponible y sin prolongar eventos vencidos. Desactivar tokens no registrados; distinguir payload inválido de token inválido antes de dar de baja un registro. Errores de credenciales/proyecto deben generar alerta operativa.

La entrega es al menos una vez: una caída después de que Firebase acepta el mensaje puede producir duplicados. Usar `eventId` también en el cliente y una política de presentación por entidad/estado para reducirlos. No prometer orden ni entrega inmediata; el cliente siempre reconcilia con la API.

## 4. Cliente Flutter: entregable externo

En el repositorio móvil, configurar `firebase_core` y `firebase_messaging`, permisos por plataforma, APNs y canales Android. Sincronizar token tras obtener una sesión OTP completa, al iniciar/restaurar sesión y en `onTokenRefresh`; conservar actualización pendiente si temporalmente falla la API.

Implementar recepción en primer plano, handler de background y apertura mediante `getInitialMessage`/`onMessageOpenedApp`. Definir una única ruta de presentación por estado para evitar que la notificación automática del sistema y una local dupliquen el aviso. Deduplicar por `eventId` cuando la aplicación controle la presentación.

Al pulsar, conservar destino mientras se autentica y verificar acceso por API antes de abrir viaje o incidente. Una invitación caducada debe mostrar el estado actual, nunca permitir aceptación por un mensaje atrasado. Retirar asociación al cerrar/cambiar cuenta. No depender de mensajes silenciosos para despertar siempre el móvil; probar límites del sistema operativo y cierre forzado.

## 5. Panel Vue: segunda etapa

Añadir SDK `firebase`, servicio `client/src/services/push.js` y control explícito «Activar notificaciones» que solicite permiso mediante acción del usuario y compruebe soporte. Registrar service worker en origen HTTPS y obtener token con clave VAPID. Con Vite, generar/bundlear el worker y su configuración pública; un archivo en `public/` no sustituye automáticamente variables `import.meta.env`.

Integrar registro/baja con `client/src/stores/auth.js` y reconciliación con `driverNotifications.js`. En foreground, evitar doble aviso entre Socket.IO y `onMessage`; en background, mostrar una sola notificación y dirigir a la ruta existente de incidentes del rol correspondiente. Restringir enlaces al propio origen y volver a comprobar autorización al abrir.

Actualizar argumentos de build en `client/Dockerfile` y despliegue. En `client/nginx.conf`, añadir una regla exacta para el worker con revalidación o sin caché: hoy los `.js` reciben caché `immutable` por siete días. Garantizar archivo JavaScript real, no el fallback HTML de la SPA, y alcance correcto del worker. Permiso denegado o navegador sin soporte no debe impedir usar el panel.

## 6. Pruebas y activación

1. Unitarias con proveedor Firebase simulado: destinatarios, payloads, TTL, reintentos, clasificación de errores y ausencia de secretos en logs.
2. Integración PostgreSQL en esquema temporal: registro idempotente, rotación, cambio de cuenta, aislamiento de usuarios, sesiones revocadas/vencidas, rollback conjunto de negocio/outbox y conflictos concurrentes.
3. Worker: dos procesos sin reclamar el mismo trabajo, recuperación tras caída, deduplicación por instalación, éxito parcial, evento vencido y caída después de aceptación del proveedor.
4. Regresión de viajes: varios conductores aceptando a la vez; solo una asignación y descarte de invitaciones obsoletas. Pánico idempotente y atención antes del envío.
5. Dispositivos reales Android/iOS y navegadores objetivo: primer plano, segundo plano, arranque desde aviso, permiso rechazado, reinstalación, varias instalaciones, logout/cambio de cuenta y falta de red. Verificar por separado aceptación por FCM, recepción observada y apertura.
6. Ejecutar `npm test`, integraciones nuevas opt-in con PostgreSQL y `npm --prefix client run build` cuando se modifique Vue. No se ejecutaron suites para esta revisión documental.

Activar primero en staging con cuentas de prueba y luego mediante cohortes/flags por evento y plataforma. Observar tamaño y antigüedad de cola, latencia hasta aceptación por FCM, fallos por código, descartes por expiración y tokens inválidos. Registrar IDs de evento y entrega, nunca tokens completos. Definir alertas ante cola atrasada o errores de configuración. El rollback operativo deshabilita envíos y descarta trabajos vencidos antes de reactivarlos; Socket.IO y el flujo de negocio siguen funcionando.

## Orden de entrega y dependencias

1. PR 1: contrato, configuración Firebase, migraciones de instalaciones y API autenticada; pruebas de sesiones/propiedad.
2. PR 2: outbox, worker, integración transaccional de invitaciones y pánico, métricas y pruebas de concurrencia.
3. PR móvil, en el repositorio Flutter: permisos, registro/rotación y apertura; validar extremo a extremo antes de habilitar envíos.
4. PR 3: eventos restantes de viaje y políticas de caducidad, con pruebas por transición.
5. PR 4 opcional: web push en Vue, worker, logout web y despliegue.

Dependencias para activar: acceso al proyecto Firebase, credenciales de envío en el despliegue, package/bundle IDs y repositorio Flutter; credencial APNs si se incluye iOS. Para web se requieren origen HTTPS, configuración pública Firebase y VAPID. Estas dependencias no impiden preparar backend y contratos.

## Referencias oficiales

- Flutter, configuración y tokens: https://firebase.google.com/docs/cloud-messaging/flutter/get-started
- Web, permisos y registro: https://firebase.google.com/docs/cloud-messaging/web/get-started
- Web, foreground/background: https://firebase.google.com/docs/cloud-messaging/web/receive-messages
- Gestión de tokens: https://firebase.google.com/docs/cloud-messaging/manage-tokens
- Errores y reintentos: https://firebase.google.com/docs/cloud-messaging/error-codes
