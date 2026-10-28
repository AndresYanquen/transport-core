# Autenticación por celular para Flutter

## Paso 1: preparación de cuentas

- `AuthService.preparePhoneAccount` es una operación interna, sin endpoint público.
  Crea pasajeros (`client`) y conductores (`driver`) sin correo ni contraseña.
  No verifica el teléfono ni emite tokens o sesiones. No recibe como autoridad
  campos del cliente tales como `phoneVerified`, `role` o `status`.
- Los conductores siguen requiriendo licencia y datos del vehículo. Se conserva
  la política configurada de aprobación de conductores.
- Los números se normalizan a E.164, con Colombia como país predeterminado
  configurable mediante `DEFAULT_PHONE_COUNTRY`.
- Un número identifica una sola cuenta móvil activa en términos de borrado:
  no puede repetirse entre pasajeros y conductores mientras `deleted_at` sea nulo,
  incluso si una cuenta está suspendida. Administradores y operadores quedan
  fuera de la búsqueda móvil y del índice de unicidad móvil.
- El acceso administrativo conserva su flujo. El registro por correo permanece,
  pero desde la revisión de seguridad no permite reservar teléfonos sin OTP:
  el celular se vincula después de iniciar sesión o se usa el registro OTP.
  La migración no obliga a las cuentas por correo/Google a tener teléfono.
- La creación por operador o WhatsApp permanece sin verificación. Si el número
  pertenece a un conductor, no se reutiliza como pasajero: se devuelve conflicto.

Aplicar con `npm run migrate:latest`. La migración falla ante números duplicados
o formatos no normalizados; no borra ni fusiona datos. No requiere conciliación
de cuentas para el entorno de desarrollo.

## Paso 2: registro y login con OTP

### Inalambria

Fuentes: [documentación](https://api.inalambria.express/docs/) y
[OpenAPI](https://api.inalambria.express/docs/openapi.json), revisadas para esta integración.
La API documenta transporte SMS, no generación ni validación de OTP.
Usamos `POST https://api.inalambria.express/v1/messages/send` con autenticación
`Authorization: Bearer <API key>` y cuerpo con `content`, `recipients` en E.164,
`async: false` y `flashSms: false`. Se exige HTTP 200, `ok: true`, un mensaje
y un identificador `consumptionId`. Una respuesta 202 no se trata como envío
completado. La aceptación del proveedor no demuestra entrega al teléfono.

Los errores de autenticación, saldo, permisos, validación, límites y servicio,
así como los timeouts, producen un error local 503 sin filtrar el cuerpo del
proveedor, la API key ni el código. No hay reintentos automáticos, porque la
operación de envío no documenta una clave de idempotencia. Tras un timeout
puede llegar un SMS cuyo desafío no será aceptado; solicitar otro tras la espera.
La especificación identifica el Bearer como API key (`sk_live_...`/`sk_test_...`),
sin endpoint de renovación ni plazo de expiración documentados. No se inventa
un refresh de credenciales. Un 401/402/403/429 abre un bloqueo compartido de SMS
durante quince minutos y emite una alerta; revisar/rotar la API key o el saldo
según el motivo antes de reactivar. El bloqueo no reenvía solicitudes anteriores.

### Configuración

En `.env`, colocar el token en `INALAMBRIA_API_KEY` y activar
`PHONE_AUTH_ENABLED=true`. `PHONE_OTP_HASH_SECRET` debe ser un secreto aleatorio
independiente de al menos 32 caracteres; el archivo local ya tiene uno generado.
Los ejemplos de entorno dejan este valor vacío para que cada despliegue genere
el suyo. Cambiarlo invalida los desafíos pendientes y reinicia la identidad de
los contadores por teléfono/IP. No debe rotarse para eludir límites.

La activación también exige `PHONE_AUTH_ROLLOUT_PERCENT` (0 por defecto) o incluir
el número E.164 en `PHONE_AUTH_ALLOWED_NUMBERS`. Para desarrollo/pruebas,
`PHONE_SMS_PROVIDER=mock` simula la entrega sin red, SQL con códigos planos ni
logs de códigos; las pruebas leen un buzón efímero dentro del proceso. No existe
endpoint para consultar códigos. Producción rechaza el proveedor mock.

`PHONE_OTP_ALLOWED_COUNTRIES=CO` restringe inicialmente los destinos a Colombia.
`PHONE_OTP_GLOBAL_DAILY_LIMIT=100` y `PHONE_OTP_GLOBAL_MINUTE_LIMIT=10` limitan
las reservas de envío en ventanas móviles de 24 horas y un minuto. El cupo local
inicial de 1000 se redujo a 100. Ajustar estos valores al presupuesto y al precio
por SMS contratado: el límite cuenta SMS, no pesos colombianos.
El flujo permanece deshabilitado por defecto; no hay códigos fijos
ni endpoint para consultar códigos en desarrollo.

Aplicar la migración con `npm run migrate:latest` y reiniciar el backend después
de configurar las variables.

### Contrato para Flutter

1. `POST /api/auth/phone/request-otp`

   ```json
   {
     "phoneNumber": "+573001112233",
     "accountType": "client",
     "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902",
     "requestId": "5bb74096-1ef7-4adb-836b-6a612f96bc3c"
   }
   ```

   `accountType` admite `client` o `driver`; por defecto es `client`.
   `deviceId` es un UUID v4 persistente de la instalación. `requestId` es otro
   UUID v4, nuevo para cada envío deliberado, que debe conservarse al reintentar
   una solicitud por error de red. Repetirlo no envía otro SMS ni consume cupo
   adicional. Cambiar teléfono, dispositivo, propósito o tipo de cuenta con el
   mismo identificador se rechaza.

   Responde 200 con `challengeId`, `expiresIn` (hasta 300 segundos),
   `retryAfter: 60` y `deliveryStatus: sent|pending`, sin revelar si existe la
   cuenta. `pending` puede aparecer en un reintento mientras el primer envío
   sigue en curso. Esta solicitud no crea usuarios.

2. `POST /api/auth/phone/verify-otp`

   ```json
   {
     "challengeId": "uuid-del-desafio",
     "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902",
     "code": "012345",
     "rememberMe": true,
     "device": { "name": "Mi celular", "platform": "android", "appVersion": "1.0.0" },
     "registration": { "firstName": "Juan", "lastName": "Perez" }
   }
   ```

   El código es una cadena de seis dígitos. `registration` es opcional para
   pasajeros y se ignora al iniciar sesión en cuentas existentes. Para registrar
   un conductor nuevo, debe incluir `registration.driverProfile` con
   `licenseNumber`, `vehicleMake`, `vehicleModel` y `vehiclePlate`.
   Los campos privilegiados no se aceptan como autoridad. Se conserva la política
   configurada de aprobación del conductor; verificar el celular no lo aprueba.

   La respuesta 200 incluye `user`, `accessToken` (también `token` por compatibilidad),
   `refreshToken`, `expiresIn`, `refreshExpiresIn`, `rememberMe` e `isNewUser`.
   El OTP exitoso crea la cuenta y entrega una sesión normal aunque no se haya
   enviado nombre. Dentro de `user`, el backend informa:

   ```json
   {
     "firstName": null,
     "registrationComplete": false,
     "missingRegistrationFields": ["firstName"]
   }
   ```

   Flutter debe guardar la sesión y mostrar **Completa tu nombre** cuando
   `user.registrationComplete` sea `false`, antes de navegar al inicio de la app.
   Guardar el nombre mediante `PATCH /api/users/me` con
   `{ "firstName": "María José" }`. La respuesta devuelve el usuario actualizado
   con `registrationComplete: true` y `missingRegistrationFields: []`.
   El apellido es opcional. Se reutiliza la validación existente: nombre no vacío
   después de `trim`, máximo 100 caracteres.

   El estado se calcula a partir del nombre guardado; no depende de `isNewUser`.
   También está presente en `/api/auth/me`, `/api/users/me`, las respuestas de
   refresh y las actualizaciones del perfil. Por tanto, Flutter debe comprobarlo
   al restaurar una sesión, aunque `isNewUser` sea `false`. Una cuenta móvil
   antigua sin nombre se representa igualmente como pendiente. Si el registro
   OTP ya incluye nombre, se devuelve completo desde el inicio.

   No hay token temporal de registro, migración adicional ni restricciones nuevas
   sobre viajes u otros endpoints. La sesión es normal; la navegación obligatoria
   hacia completar el nombre corresponde a Flutter. Los indicadores son de solo
   lectura: no se deben enviar en `PATCH /api/users/me`.

   Usa los endpoints existentes `/api/auth/refresh`, `/logout` y `/logout-all`.
   Flutter debe proteger el refresh token en el almacenamiento seguro del sistema.
   No se reconoce un dispositivo por un identificador enviado por Flutter:
   sin credenciales de sesión válidas se requiere OTP.

3. Vincular un teléfono a una cuenta existente de Google/correo:
   `POST /api/auth/phone/link/request-otp` y
   `POST /api/auth/phone/link/verify-otp` usan el mismo formato y exigen
   `Authorization: Bearer <access token>` de la cuenta móvil existente.
   El desafío queda vinculado al usuario autenticado y al propósito de vincular;
   no se puede usar en el endpoint de login ni con otra cuenta. La verificación
   devuelve `user`, los tokens y la sesión de instalación creada con ese OTP,
   sin crear una cuenta nueva. Si el número
   pertenece a otra cuenta, no se fusionan identidades. Este flujo no sustituye
   un número ya verificado; ese cambio requiere la siguiente etapa de seguridad.

   Un teléfono no verificado guardado en una cuenta con correo/contraseña no es
   todavía un factor de login: debe verificarse desde este flujo autenticado.
   Las cuentas sin credenciales creadas por operador/WhatsApp sí pueden reclamar
   su número mediante el flujo público. Google no auto-vincula un correo local
   sin verificar, incluso ante un alta concurrente. Una cuenta sin teléfono y
   otra sin correo no se pueden identificar como la misma persona sin pruebas
   adicionales: Flutter debe usar la vinculación autenticada, no otro registro.

Los errores son 400 para formatos/perfiles inválidos, 401 para desafíos inválidos,
vencidos, consumidos o cuentas incompatibles/no activas, 429 para límites y 503
para integración deshabilitada o fallo de SMS. Los límites OTP incluyen
`Retry-After` y `retryAfter`. También sigue aplicando el límite general de auth.

### Persistencia y protección

- OTP generado con aleatoriedad criptográfica, protegido con HMAC-SHA256 y
  vinculado a desafío, teléfono, tipo de cuenta y propósito de acceso.
- Vigencia de cinco minutos, máximo cinco intentos por desafío y cinco
  verificaciones por teléfono en una ventana de quince minutos. Reenviar no
  reinicia el presupuesto agregado de verificación.
- Un solo desafío vigente por teléfono: reenviar invalida el anterior, incluso
  al cambiar el tipo de cuenta solicitado.
- Envíos: 60 segundos entre solicitudes, tres por hora y diez por 24 horas por
  teléfono; tres por hora por dispositivo; veinte por quince minutos por IP;
  diez por minuto y cien por 24 horas globalmente (estos dos últimos configurables).
  Los envíos usan ventanas móviles, evitando ráfagas al cambiar de ventana.
  IPv6 se agrupa por prefijo /64. `HTTP_TRUST_PROXY` debe coincidir con los proxies
  reales, y el backend debe recibir tráfico a través de ellos: no confiar en
  `X-Forwarded-For` arbitrario ni usar CORS como control contra bots.
- Las reservas de esta etapa están en PostgreSQL, compartidas entre procesos,
  bajo un bloqueo común antes de cualquier envío. Si falla la base, no se envía SMS. Los intentos
  de envío aceptados por el limitador consumen presupuesto aunque falle el proveedor.
- Reintentos idempotentes y envíos se registran sin texto de SMS ni código plano.
  Un timeout/resultado incierto se marca `unknown`; un proceso interrumpido puede
  dejar `pending`. No se reenvía automáticamente ninguno de los dos, y no se
  autoriza otro SMS al teléfono hasta vencer el desafío. Un fallo al persistir
  la aceptación también conserva la reserva y no autoriza otro despacho.
- Se emiten eventos estructurados `phone_otp_sms_budget_alert` al 80 % y al
  agotarse el cupo global por minuto/24 horas, y `phone_otp_sms_provider_blocked`
  ante bloqueo del proveedor. Conectar esos eventos al sistema de monitoreo para
  recibir notificaciones; el backend no envía alertas por SMS/correo automáticamente.
  No se registran códigos, API keys, contenido del proveedor ni parámetros query.
- La creación de cuenta, verificación del celular, emisión del refresh token y
  consumo del desafío se confirman juntos. Un fallo revierte todos esos cambios.
- Cuentas existentes por operador/WhatsApp pueden iniciar sesión tras verificar
  su número; se conserva su identidad, historial y perfil. No se fusionan cuentas
  ni se cambia su rol. Este flujo no autentica administradores ni operadores.
- `deviceId` es una señal de limitación y asociación del desafío, no una identidad
  de hardware verificable. Puede rotarse; los topes globales e IP/teléfono siguen
  aplicando. No se garantiza bloquear todos los bots: un atacante distribuido
  todavía puede agotar el cupo autorizado y afectar disponibilidad, pero no
  superar ese cupo mediante solicitudes concurrentes. Attestation/WAF pueden
  añadirse después sin convertir el identificador cliente en prueba de confianza.
- La asociación y persistencia por instalación se describen en
  [sesiones móviles](mobile-sessions.md). Para renovar una sesión móvil se envían
  el refresh token y su `deviceId`; no se pide otro SMS mientras siga válida.
- Pendiente: listado/gestión de sesiones por identificador, verificación real de
  passkeys y cambio reforzado de número, correspondientes a las siguientes etapas.

### Pruebas y mantenimiento

`npm test` ejecuta las pruebas unitarias. Para las pruebas reales de concurrencia
y transacciones: `npm run test:auth:integration`.
Estas crean y eliminan un esquema aislado, usan transporte SMS simulado y no
envían mensajes reales. La cuenta de pruebas necesita permiso para crear esquemas.
Incluyen conexiones HTTP y Socket.IO locales y recuperación concurrente de
contraseña; ver [contrato Flutter](flutter-auth-contract.md) y
[validación y activación](auth-validation-release.md).

Programar limpieza periódica de desafíos vencidos y contadores cuyo `reset_at`
ya haya pasado. Conservar el registro de envíos/idempotencia: eliminarlo elimina
su historial de cuotas y permite reutilizar identificadores. No borrar reservas
de las últimas 24 horas ni automatizar reenvíos de estados `pending`/`unknown`.
No eliminar contadores activos ni desafíos vigentes. La limpieza
no es necesaria para rechazar códigos vencidos: se comprueba al verificar.
