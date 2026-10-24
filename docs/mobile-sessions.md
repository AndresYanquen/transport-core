# Sesiones por instalación de Flutter

## Autenticación e identidad de instalación

Cada acceso completo de pasajero/conductor requiere una sesión móvil creada
mediante OTP. `deviceId` es un UUID v4 generado para la instalación; no prueba
identidad ni autoriza a restaurar una sesión. Solo un OTP válido crea una sesión,
y solo un refresh token válido, de esa sesión/instalación, la renueva.

Al verificar OTP, Flutter puede enviar metadatos opcionales:

```json
{
  "challengeId": "UUID del desafio",
  "code": "012345",
  "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902",
  "rememberMe": true,
  "device": {
    "name": "Pixel personal",
    "platform": "android",
    "appVersion": "1.0.0",
    "osVersion": "15"
  }
}
```

`device.platform` admite `android` o `ios`; todos los metadatos son opcionales,
tienen longitudes limitadas y se consideran declaraciones del cliente. No
otorgan permisos ni acreditan biometría, passkeys o un segundo factor.

## Persistencia y credenciales

`auth_mobile_sessions` guarda usuario, instalación, familia, fechas, política de
persistencia, método `sms_otp`, metadatos y revocación. Cada sesión tiene una
familia propia. `auth_refresh_tokens.session_id` y una clave foránea compuesta
impiden asociar un token a otro usuario o familia de sesión.

La respuesta de verificación conserva los campos de tokens e incluye `session`:
`id`, `installationId`, `deviceName`, `platform`, `appVersion`, `osVersion`,
`createdAt`, `lastUsedAt`, `expiresAt`, `absoluteExpiresAt` y `authMethod`.
El access token incluye `sid`, generado por el servidor. No hay un endpoint para
obtener una sesión o tokens presentando únicamente `deviceId` o `session.id`.

Una nueva verificación OTP en la misma instalación y usuario reemplaza la sesión
anterior y revoca su familia, dentro de la misma transacción que consume el OTP.
Otra instalación tiene una sesión/familia independiente. Una instalación no
puede revocar la sesión de otro usuario por compartir su `deviceId`.

## Renovación sin SMS

`POST /api/auth/refresh` recibe:

```json
{
  "refreshToken": "credencial opaca guardada por Flutter",
  "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902"
}
```

Para sesiones móviles, `deviceId` debe coincidir con la instalación original,
pero no reemplaza al refresh token. El servidor rota el token dentro de su misma
familia y mantiene el mismo `session.id`. Un refresh no envía SMS ni permite
cambiar instalación, nombre, plataforma o versión de la sesión. `rememberMe` se
fija al crear la sesión: enviarlo de nuevo no amplía el plazo.

La renovación actualiza `lastUsedAt` y el vencimiento por inactividad. El máximo
absoluto se fija al crear la sesión mediante `MOBILE_SESSION_MAX_TTL_SECONDS`
(30 días por defecto). El plazo por inactividad usa las variables existentes
`REFRESH_TOKEN_TTL_SECONDS` y `REFRESH_TOKEN_REMEMBER_ME_TTL_SECONDS`, siempre
limitado por ese máximo absoluto. Después del vencimiento se exige otro OTP.

Flutter debe renovar de forma serial: varias peticiones no deben reutilizar el
mismo refresh token. La reutilización detectada revoca toda esa familia/sesión;
no afecta a las sesiones de otras instalaciones. No hay ventana de gracia para
reutilizar un token rotado.

`POST /api/auth/logout` con el refresh token revoca esa sesión y su familia.
`POST /api/auth/logout-all` autenticado revoca todas las sesiones del usuario.
La revocación se comprueba en HTTP y al conectar Socket.IO; los paquetes entrantes
de un socket móvil también comprueban sesión y expiración del access token.
Una revocación confirmada desconecta los sockets de esa sesión, incluso inactivos.
El adaptador Redis propaga la desconexión a los otros procesos conectados.
Una comprobación periódica adicional detecta cambios externos en base de datos:
`SOCKET_SESSION_CHECK_INTERVAL_MS=5000` por defecto, limitado entre 100 y 60000 ms.
Los eventos ya en tránsito no se pueden retirar del cliente.

## Reinstalación y pérdida de credenciales

Flutter debe conservar el refresh token en almacenamiento seguro del sistema,
reemplazarlo después de cada renovación y no incluirlo en logs. La recuperación
solo con un identificador de instalación está prohibida.

En la primera ejecución de una instalación nueva o reinstalada, generar otro
`deviceId` y descartar credenciales de una instalación anterior, incluso si el
almacenamiento seguro o una copia de respaldo las conserva. Una reinstalación o
la pérdida del refresh token requiere autenticarse con OTP. La sesión vieja no
se elimina automáticamente: expira o puede cerrarse desde otra sesión.

El backend no puede detectar una reinstalación física si el cliente restaura
exactamente el mismo identificador y las mismas credenciales. Tampoco se afirma
vinculación criptográfica a hardware: son credenciales Bearer; passkeys y claves
de dispositivo se incorporan en la etapa correspondiente.

## Correo, Google y acceso administrativo

Las rutas de correo y Google no permiten saltarse OTP omitiendo `deviceId`.
Para una cuenta móvil que aún no verificó teléfono, sus tokens sin `sid` sirven
solo para `/api/auth/me`, `/api/auth/logout-all` y las rutas autenticadas
`/api/auth/phone/link/request-otp` y `/api/auth/phone/link/verify-otp`.
No habilitan viajes ni Socket.IO. Completar la vinculación con OTP entrega una
sesión de instalación y sus tokens; Flutter debe sustituir los de inscripción.

Después de verificar el teléfono, los tokens anteriores sin sesión no habilitan
el acceso ni restauran una sesión mediante refresh. El backend devuelve 401
`OTP_REQUIRED` y exige el flujo OTP para esos accesos.
Administradores y operadores conservan el flujo existente de Vue.

## Protección adicional opcional

La política de servidor `users.mobile_additional_factor_required` está desactivada
por defecto. Si se activa, crear una sesión móvil devuelve 403
`ADDITIONAL_FACTOR_REQUIRED` y no consume OTP ni crea/reemplaza una sesión.
Tampoco puede eludirse mediante Google/correo o un booleano enviado por Flutter.

Esta etapa prepara un bloqueo seguro, no implementa todavía passkeys ni un
verificador de biometría. No hay endpoint público para activar/desactivar la
política. Hasta implementar una prueba adicional verificable por el servidor,
activar esa política bloquea nuevos accesos. Las sesiones válidas creadas antes
conservan su renovación; cambiar esta política no equivale a revocarlas.

## Validación

La suite de integración PostgreSQL usa un esquema temporal y proveedor SMS
simulado. Cubre familias independientes, asociación del JWT, renovación sin SMS,
política de persistencia, reemplazo por instalación, credenciales perdidas,
caducidad absoluta, cierre individual/global, token reutilizado, bloqueo por
factor adicional, rollback y carrera entre renovación/cierre. La suite unitaria
comprueba metadatos, prohibición de acceso por identificadores y middleware.
En esta etapa pasaron 191 pruebas unitarias y 31 escenarios de integración
(32 contando el contenedor padre del runner), sin envíos reales de SMS.
La ampliación posterior de pruebas de red y despliegue está registrada en
[validación y activación](auth-validation-release.md).
