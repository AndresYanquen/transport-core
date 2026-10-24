# Guía de implementación de autenticación en Flutter — GotTaxi

Documento para implementar la app Android/iOS contra el backend actual.
Complementa el [contrato HTTP](flutter-auth-contract.md), el
[modelo de sesiones](mobile-sessions.md) y la [activación gradual](auth-validation-release.md).

## 1. Alcance y entregas

| Funcionalidad | Backend actual | Trabajo en Flutter |
|---|---|---|
| Registro/login con celular | Disponible | Pantallas de teléfono, código y perfil |
| Sesiones por instalación | Disponible | UUID de instalación y persistencia segura |
| Refresh y revocación | Disponible | Renovación serializada, manejo de 401 y cierre |
| Google con vinculación de celular | Disponible | Inscripción y OTP antes de acceso completo |
| Socket.IO autenticado | Disponible | Conexión con access token y reconexión controlada |
| Desbloqueo local con biometría | Puede añadirse en Flutter | Protección local opcional; no acredita un factor al servidor |
| Passkeys como factor del servidor | Pendiente | Preparar el estado de interfaz, sin inventar endpoints |
| Cambiar un teléfono verificado | Pendiente | No habilitar sustitución mediante vinculación |
| Recuperación sin el teléfono anterior | Pendiente | No crear otra cuenta para simular recuperación |
| Listar/revocar otra sesión por ID | Pendiente | Ofrecer cierre actual o cierre global disponibles |

Los roles móviles son `client` y `driver`. `admin` y `operator` corresponden a
Vue; la app debe rechazar esas identidades como sesión móvil y el backend conserva
la autorización de cada endpoint.

Orden de entrega: infraestructura y almacenamiento → OTP → restauración/refresh
→ Google/vinculación → Socket.IO/cierre → protección local opcional → pruebas.

## 2. Arquitectura propuesta

Adaptar esta separación al gestor de estado que ya use la app; no es necesario
cambiar entre BLoC, Riverpod u otro sistema para integrar autenticación.

```text
lib/features/auth/
  data/
    auth_api.dart                  # Llamadas de autenticación sin reintentos globales
    credential_store.dart          # Documento de sesión en almacenamiento seguro
    installation_store.dart        # UUID de instalación y control de primera ejecución
    auth_repository.dart           # Aplica transiciones y coordina persistencia
  domain/
    auth_state.dart
    otp_challenge.dart
    session_credentials.dart
    auth_failure.dart
  application/
    auth_controller.dart
    refresh_coordinator.dart       # Una renovación compartida por todas las peticiones
  presentation/
    phone_page.dart
    otp_page.dart
    driver_registration_page.dart
    phone_enrollment_page.dart
    session_expired_page.dart
lib/core/network/
  api_client.dart                  # Bearer e interceptor de recursos protegidos
  socket_manager.dart
```

Responsabilidades importantes:

- `AuthApi` usa un cliente HTTP sin interceptor que intente renovar autenticación.
  Así se evitan bucles al fallar `/refresh` o al introducir un OTP incorrecto.
- `ApiClient` consume recursos protegidos y comparte `RefreshCoordinator`.
- `CredentialStore` serializa escrituras, limpieza y reemplazo de credenciales.
- `SocketManager` observa cambios de sesión; no conserva conexiones de otro usuario.
- `AuthController` es la única fuente de estado de autenticación para navegación.

## 3. Dependencias y configuración de plataforma

Reutilizar paquetes existentes y elegir versiones compatibles con el SDK de la
app. Fijar las versiones resueltas en `pubspec.lock` y revisar los requisitos de
Android/iOS de cada versión antes de instalar.

| Necesidad | Referencia del mantenedor |
|---|---|
| HTTP, interceptores y timeouts | [dio](https://pub.dev/packages/dio) |
| Credenciales en almacenamiento protegido | [flutter_secure_storage](https://pub.dev/packages/flutter_secure_storage) |
| UUID v4 de instalación/solicitud | [uuid](https://pub.dev/packages/uuid) |
| Metadatos opcionales del dispositivo | [device_info_plus](https://pub.dev/packages/device_info_plus) |
| Versión de la app | [package_info_plus](https://pub.dev/packages/package_info_plus) |
| Conexión Socket.IO | [socket_io_client](https://pub.dev/packages/socket_io_client) |
| Prueba de identidad Google | [google_sign_in](https://pub.dev/packages/google_sign_in) |
| Autenticación local opcional | [local_auth](https://pub.dev/packages/local_auth) |

Configurar Keychain/almacenamiento Android según la documentación del paquete
seleccionado, incluida su política de accesibilidad y exclusión de respaldos.
Una preferencia local de biometría debe contemplar dispositivos sin biometría,
cancelación, bloqueo del sistema y credenciales del sistema operativo.

La app solo conoce la URL de GotTaxi, por ejemplo mediante
`--dart-define=API_BASE_URL=https://api.example.com`. El dominio del ejemplo debe
sustituirse por el entorno real. Inalambria, su API key y el secreto HMAC permanecen
en el backend; nunca se incluyen en Flutter ni se llama al proveedor desde la app.

Usar HTTPS en entornos publicados. La configuración HTTP local de emuladores se
limita al entorno de desarrollo. Mantener separados desarrollo, staging y producción.

### Timeouts

El backend espera hasta **18 segundos** a Inalambria. Configurar un margen mayor
en Flutter para solicitar OTP: como punto de partida, `connectTimeout` y
`sendTimeout` de diez segundos y `receiveTimeout` de treinta segundos. Son valores
iniciales para medir, no una garantía de que cada respuesta llegue a tiempo.

Ejemplo de configuración Dio, para adaptar al proyecto:

```dart
final authDio = Dio(BaseOptions(
  baseUrl: apiBaseUrl,
  connectTimeout: const Duration(seconds: 10),
  sendTimeout: const Duration(seconds: 10),
  receiveTimeout: const Duration(seconds: 30),
  headers: {'Content-Type': 'application/json'},
));
```

No habilitar reintentos automáticos de envío de SMS ni logging de cuerpos, headers
de autorización, respuestas de tokens o códigos. Redactar también reportes de
errores de Dio y herramientas de analítica/crash reporting.

## 4. Instalación y almacenamiento

### Identificadores

- `deviceId`: UUID **v4**, aleatorio, estable durante esa instalación. No usar IMEI,
  modelo, identificador publicitario, correo ni número de celular.
- `requestId`: otro UUID **v4** por envío deliberado de SMS. Conservarlo para los
  reintentos de red de la misma operación.
- `challengeId`: UUID emitido por GotTaxi; no generarlo ni modificarlo en Flutter.
- `session.id`: identidad de sesión emitida por GotTaxi; no equivale al `deviceId`.

Guardar el `deviceId` junto con el documento seguro de credenciales y comprobar
que coincida con `session.installationId`. Conservarlo al cerrar sesión normalmente;
un logout no es una reinstalación.

### Documento de credenciales

Guardar como una unidad lógica, con escrituras serializadas:

```text
schemaVersion
environmentId / apiOrigin
deviceId
refreshToken
sessionId
userId
refreshExpiresAt
absoluteExpiresAt
```

El access token puede mantenerse solo en memoria. Después de abrir la app,
renovarlo con el refresh token y consultar `/me`. Si se decide persistirlo,
usar también almacenamiento protegido; nunca preferencias sin cifrar.

No considerar que hay una sesión autenticada solamente porque existe un usuario
en caché. El servidor debe aceptar las credenciales. No mezclar tokens de staging
y producción ni restaurar una sesión de un usuario anterior al cambiar de cuenta.

### Reinstalación

Usar una marca local de instalación excluida de respaldos y coordinarla con el
almacenamiento seguro. Si la marca falta, borrar credenciales heredadas del
almacenamiento seguro y generar otro `deviceId`. No borrar datos legítimos durante
una actualización normal; probar por separado actualizar y reinstalar.

Verificar el comportamiento real en Android e iOS: restaurar una copia o conservar
elementos de Keychain puede hacer reaparecer credenciales. El backend no puede
detectar una reinstalación si se restauran exactamente el mismo ID y los mismos
tokens. Una instalación nueva o sin refresh token vuelve al OTP.

## 5. Estados y navegación

Estados sugeridos:

```text
initializing
signedOut
requestingOtp
awaitingOtp
verifyingOtp
phoneEnrollmentRequired
authenticated
refreshing
offlineWithStoredCredentials
reauthenticationRequired
additionalFactorRequired
signingOut
```

Transiciones principales:

| Evento | Siguiente estado |
|---|---|
| Inicio sin credenciales | `signedOut` |
| Inicio con refresh token | `refreshing` → `/me` → `authenticated` |
| Sin conexión antes de intentar renovar | `offlineWithStoredCredentials`; no declarar autorización del servidor |
| Solicitud OTP aceptada | `awaitingOtp` |
| Código aceptado y sesión presente | Persistir credenciales → `authenticated` |
| Google/correo sin `session` | `phoneEnrollmentRequired` |
| OTP equivocado | Continuar `awaitingOtp` con error genérico |
| Refresh rechazado | `reauthenticationRequired` |
| Factor adicional requerido | `additionalFactorRequired` |
| Logout confirmado o limpieza local | `signedOut` |

Mostrar una pantalla inicial mientras se restaura sesión para evitar un salto
visual a login y luego a la app. Recalcular vencimientos al volver del segundo
plano; no depender de que `Timer.periodic` siga ejecutándose en background.

## 6. Registro e inicio de sesión con celular

### 6.1 Captura de datos

Pedir país/número y tipo de cuenta. Para Colombia, mostrar el prefijo `+57` y
enviar E.164, por ejemplo `+573001112233`. Hacer una validación local de ayuda,
pero respetar la validación y países habilitados del backend.

Enviar siempre `accountType` explícito: `client` o `driver`. No cambiar de rol
automáticamente ante un error y no consultar si el teléfono existe: no hay un
endpoint público de existencia.

Para un registro de conductor, recoger los datos obligatorios antes de verificar
OTP. En el acceso de un conductor existente no es necesario reenviarlos.

### 6.2 Solicitar SMS

`POST /api/auth/phone/request-otp`, sin Bearer:

```json
{
  "phoneNumber": "+573001112233",
  "accountType": "client",
  "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902",
  "requestId": "5bb74096-1ef7-4adb-836b-6a612f96bc3c"
}
```

Respuesta ilustrativa HTTP 200:

```json
{
  "challengeId": "e7d64dc1-16f3-478f-99d8-d1e165140007",
  "expiresIn": 298,
  "retryAfter": 60,
  "deliveryStatus": "sent"
}
```

`sent` significa aceptación del proveedor, no confirmación de entrega al celular.
Un reintento puede responder `pending` mientras continúa la primera solicitud.
Guardar el contexto teléfono/tipo/propósito/usuario junto con su `requestId`.
No reutilizar ese ID para otro número, otra cuenta o el flujo de vinculación.

Deshabilitar el botón mientras exista una solicitud en curso y respetar el plazo
de reenvío. Al cambiar número o tipo de cuenta, invalidar el estado local anterior
y descartar respuestas tardías de esa solicitud.

### 6.3 Verificar OTP

El código es una **cadena de seis dígitos**; conservar ceros iniciales. Habilitar
pegado y autofill del sistema operativo cuando sea compatible, sin pedir permisos
de lectura general de SMS. No copiar códigos a analítica ni confirmar un envío
de código nuevo automáticamente al abrir la pantalla.

`POST /api/auth/phone/verify-otp`:

```json
{
  "challengeId": "e7d64dc1-16f3-478f-99d8-d1e165140007",
  "code": "012345",
  "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902",
  "rememberMe": true,
  "device": {
    "name": "Mi celular",
    "platform": "android",
    "appVersion": "1.0.0",
    "osVersion": "15"
  },
  "registration": {
    "firstName": "Juan",
    "lastName": "Perez"
  }
}
```

Metadatos opcionales: `name` hasta 100 caracteres, `platform` igual a `android`
o `ios`, y `appVersion`/`osVersion` hasta 50 caracteres. Son informativos.

Para crear un conductor, incluir en `registration`:

```json
{
  "driverProfile": {
    "licenseNumber": "LICENCIA-EJEMPLO",
    "vehicleMake": "Marca",
    "vehicleModel": "Modelo",
    "vehiclePlate": "ABC123"
  }
}
```

Esos cuatro campos se validan como cadenas no vacías de hasta 50 caracteres.
`firstName` y `lastName` admiten hasta 100 caracteres cada uno.

Si un acceso de conductor resulta ser un registro nuevo y faltan esos datos,
el backend devuelve 400. Recogerlos y completar la verificación mientras el
desafío siga vigente; no generar otro SMS para corregir el perfil. Los datos de
registro no actualizan el perfil de una cuenta existente al iniciar sesión.

### 6.4 Procesar la respuesta

La respuesta contiene:

```text
user
accessToken
token                  # Alias de compatibilidad; Flutter debe usar accessToken
refreshToken
expiresIn              # Segundos de vida del access token
refreshExpiresIn       # Segundos restantes del refresh token
rememberMe
session
isNewUser
```

`session` incluye `id`, `installationId`, metadatos, `createdAt`, `lastUsedAt`,
`expiresAt`, `absoluteExpiresAt` y `authMethod`. Parsear fechas con zona horaria.
Persistir credenciales antes de navegar o abrir Socket.IO. Si falla la escritura
segura, no declarar restaurable la sesión ni continuar como si hubiera persistido.

Usar `user.role` de la respuesta para seleccionar el módulo. Para conductores,
mostrar el estado de aprobación de su perfil: autenticar el celular no aprueba
al conductor ni concede acceso al panel administrativo.

### 6.5 Errores de red y reenvíos

| Operación | Si se pierde la respuesta |
|---|---|
| Solicitar OTP | Conservar y reutilizar el mismo `requestId`; no crear otro envío automáticamente |
| Verificar OTP | Puede haberse consumido el código y creado una sesión cuya respuesta se perdió; no asumir idempotencia |
| Refresh | Puede haberse rotado el token; no reenviar el token anterior automáticamente |

La verificación y el refresh no tienen recuperación idempotente de respuestas.
Si ya no pueden obtenerse credenciales válidas, solicitar un nuevo acceso con OTP
mediante una acción explícita, respetando los límites del servidor.

OTP dura cinco minutos, admite cinco fallos por desafío y tiene presupuesto
agregado de verificaciones por teléfono. Nuevos envíos requieren al menos sesenta
segundos y están limitados a tres por teléfono/hora. La interfaz puede mostrar
temporizadores, pero nunca prometer que terminó un bloqueo solo por su reloj local.

## 7. Restauración y refresh

### Inicio de la app

1. Validar instalación y entorno; leer el documento seguro.
2. Si no hay refresh token, mostrar login.
3. Si el almacenamiento está temporalmente inaccesible o no hay red, mostrar ese
   estado sin borrar credenciales por el simple hecho de estar offline.
4. Renovar una sola vez; persistir el reemplazo y obtener `/api/auth/me`.
5. Si el servidor rechaza las credenciales, limpiarlas y volver a OTP.

`POST /api/auth/refresh`, sin necesidad de Bearer:

```json
{
  "refreshToken": "refresh-token-opaco",
  "deviceId": "3ec0d3fa-c041-4f43-9b35-c7a18bcaa902"
}
```

El ID debe coincidir con la instalación del token. El backend conserva la misma
sesión y familia y devuelve un refresh token nuevo. Cambiar `rememberMe`, nombre
o plataforma no amplía ni cambia la sesión. Los plazos los determina el servidor;
no fijar treinta días ni una hora como constantes de autorización en Flutter.

### Coordinación de concurrencia

Algoritmo de `RefreshCoordinator` — pseudocódigo, no un interceptor completo:

```text
renovar():
  si hay una renovación pendiente, devolver esa misma Future
  capturar generación de sesión y refresh token actual
  publicar la Future compartida antes de despachar la petición
  llamar /refresh con el cliente sin interceptor
  si hubo logout/cambio de usuario mientras esperaba:
    descartar respuesta; no restaurar sesión
  guardar el reemplazo con el escritor serializado
  actualizar access token en memoria y notificar al SocketManager
  limpiar la Future compartida al finalizar, tanto en éxito como en error
```

Además, cada petición protegida recuerda qué access token usó. Ante un 401:

- Si ya hay un token más nuevo, usarlo para un único reintento autorizado sin
  volver a rotar el refresh.
- Si no existe uno nuevo, compartir la misma renovación entre todas las peticiones.
- No renovar por 403/409/429 ni interceptar un 401 de `/verify-otp`, `/login`,
  `/google` o `/refresh` como si fuera un fallo de un recurso protegido.
- No reconstruir/repetir indiscriminadamente operaciones de pago, creación de
  viajes, cargas o cuerpos de streaming. Repetir una mutación exige saber que
  falló antes del negocio o que existe idempotencia de esa operación.
- Marcar el reintento para impedir un bucle de 401 → refresh → 401.

La generación de sesión y la serialización también deben cubrir logout,
cambio de cuenta y escrituras de almacenamiento; una respuesta tardía no puede
volver a guardar credenciales después de que el usuario cerró sesión.

Antes de enviar refresh, guardar un marcador seguro de renovación en curso si
se requiere tolerancia a cierres del proceso. Al reiniciar con ese marcador y
sin reemplazo confirmado, tratar el resultado como incierto y pedir OTP; no
reutilizar ciegamente el token anterior. Un timeout no prueba que no hubo rotación.

## 8. Google y vinculación de teléfono

Configurar Google Sign-In para Android/iOS según el paquete elegido y coordinar
el ID de cliente del servidor con `GOOGLE_CLIENT_ID` del backend. Enviar el
**ID token**, no el access token OAuth ni un perfil/email declarado por la app:

```json
{ "idToken": "id-token-de-google", "rememberMe": true }
```

Destino: `POST /api/auth/google`.

- Respuesta sin `session`: estado de inscripción, todavía sin acceso a viajes.
  Permite `/me`, cierre global y las rutas de vinculación.
- Para vincular: usar `/api/auth/phone/link/request-otp` y
  `/api/auth/phone/link/verify-otp`, con Bearer de esa misma cuenta y los mismos
  cuerpos OTP descritos antes. El tipo móvil lo determina el usuario autenticado.
- Al verificar, se obtiene la misma cuenta con una sesión de instalación. Reemplazar
  las credenciales de inscripción por las nuevas; no registrar otro usuario.
- `OTP_REQUIRED` en una cuenta ya verificada: abrir el acceso por celular; la
  prueba Google por sí sola no crea una sesión móvil completa.
- `409`: no fusionar identidades ni asociar un correo sin verificar desde Flutter.

La ruta Google actual crea pasajeros cuando la identidad no existe. No asumir
que enviar `accountType: driver` convierte ese registro en conductor: no forma
parte del contrato. El registro de conductor usa el flujo OTP con su perfil.

## 9. Socket.IO

Usar el cliente Socket.IO compatible con la versión 4 del servidor. No sustituirlo
por un WebSocket puro. El path actual es `/socket.io`, configurable en el backend.

Reglas de integración:

1. Crear la conexión con `auth: {token: accessToken}` después de persistir la sesión.
2. En Flutter móvil, configurar el transporte según la documentación del cliente
   seleccionado; evitar dos conexiones por activar auto-connect y llamar connect
   otra vez. Controlar una única instancia por usuario.
3. Al renovar, actualizar la autenticación y reconectar de forma controlada con el
   token nuevo. No basta cambiar un header en el cliente HTTP.
4. Reponer las suscripciones autorizadas a viajes al reconectar; no duplicar listeners.
5. Ante desconexión por expiración/revocación, usar el coordinador HTTP: si el refresh
   sigue válido, reconectar; si no, limpiar sesión. No iniciar una tormenta de refresh.
6. Ante caída de red, usar reconexión con espera progresiva mientras la sesión sea
   válida. No enviar SMS como mecanismo de reconexión.
7. En logout, destruir socket y listeners. No mostrar eventos tardíos de otro usuario.

El backend desconecta sesiones revocadas después del commit y comprueba además la
base de datos periódicamente. La desconexión no significa por sí sola que hay que
pedir OTP: primero distinguir fallo de red y expiración del access token de una
sesión rechazada por el servidor. Nunca reintentar indefinidamente un refresh incierto.

## 10. Cierre y recuperación

### Cerrar la sesión actual

`POST /api/auth/logout` con `refreshToken`. Capturar la credencial para esa llamada,
marcar que comenzó el logout, detener socket y operaciones y serializar limpieza.
Una renovación que ya estaba en vuelo no debe restaurar la sesión.

Borrar las credenciales locales incluso si no hay red, pero mostrar con precisión
que el cierre remoto no pudo confirmarse. No afirmar que el servidor revocó una
sesión solamente porque la app borró su almacenamiento. Probar la carrera
logout/refresh; el backend revoca la familia de sesión completa.

### Cerrar todas

`POST /api/auth/logout-all` con Bearer válido. Invalida también la instalación actual:
después de confirmarlo, limpiar estado y volver a OTP. No hay todavía listado de
otros dispositivos ni revocación individual de una sesión ajena por identificador.

### Recuperar acceso

- Con el mismo celular disponible: OTP desde la instalación nueva recupera la
  misma cuenta. No crea otra identidad; otras sesiones siguen independientes.
- Cuenta con contraseña: `/forgot-password` y `/reset-password` ofrecen recuperación
  por correo. Gestionar el enlace en la app solo después de configurar enlaces
  Android/iOS y la URL de recuperación con backend. El backend actual genera el
  enlace usando `APP_PUBLIC_URL` y `/reset-password?token=...`; no asumir que ya es
  un universal/app link. No registrar ese token ni reenviarlo a analítica.
- Sin acceso al número anterior: no hay recuperación implementada por otro factor
  ni por soporte. No sustituir el número con las rutas de vinculación.

## 11. Biometría, passkeys y cambio de número

Puede añadirse desbloqueo local opcional antes de leer/usar las credenciales,
con configuración explícita, manejo de cancelación y pruebas en ambos sistemas.
No anunciarlo como MFA del servidor: un resultado local de `local_auth` no es una
prueba criptográfica verificada por GotTaxi.

No enviar `additionalFactorVerified: true`, datos biométricos ni flags similares
como autorización. El backend no los acepta. Si responde
`403 ADDITIONAL_FACTOR_REQUIRED`, mantener un estado de acceso bloqueado; no
abrir la app ni generar más OTP para intentar saltarlo.

Mantener las funciones de passkeys, cambio de número y recuperación alternativa
deshabilitadas hasta disponer de sus contratos de backend. El futuro cambio de
número deberá verificar identidad existente y número nuevo, confirmar el cambio y
revocar sesiones según la política; no hay aún endpoints para implementar esa UI.

## 12. Errores y mensajes

| Respuesta | Conducta de interfaz |
|---|---|
| 400 | Resaltar campos o completar perfil; no solicitar otro SMS automáticamente |
| 401 en OTP | Mensaje genérico de código inválido/vencido; conservar contexto para corregir o reenviar explícitamente |
| 401 `OTP_REQUIRED` | Volver al acceso OTP; no usar ID de dispositivo como recuperación |
| 401 en un recurso | Un refresh coordinado si procede; un solo reintento seguro |
| 401 en refresh | Limpiar sesión y pedir OTP |
| 403 `ADDITIONAL_FACTOR_REQUIRED` | Acceso bloqueado, sin afirmar que biometría local lo resuelve |
| 403 por permisos | Pantalla de acceso denegado; no probar otro rol |
| 409 | Conflicto de identidad/datos; no fusionar ni crear un usuario alternativo automáticamente |
| 429 | Leer `Retry-After`/`retryAfter`, mostrar espera; el rate limit general puede tener otro formato |
| 503 | Servicio/cohorte/proveedor no disponible o estado incierto; conservar idempotencia, sin reenvíos automáticos |
| Red/timeout | Mostrar incertidumbre; no equipararla a rechazo de credenciales |

`Retry-After` puede llegar en segundos o como fecha HTTP. Priorizar la instrucción
del servidor y recalcular la espera al reanudar la app. No mostrar mensajes que
confirmen públicamente si un teléfono existe ni copiar detalles internos a la UI.

## 13. Pruebas de aceptación Flutter

Usar un `AuthApi` falso en unitarias/widgets y el proveedor mock del backend en
integración. No agregar códigos universales, endpoints para leer OTP ni SMS reales
a CI. El buzón mock del backend se consume dentro de su proceso de pruebas, no
desde la app pública.

Casos mínimos:

1. Pasajero nuevo y existente; conductor nuevo con perfil y existente sin perfil.
2. Código con cero inicial, incompleto, incorrecto, vencido y reutilizado.
3. Doble toque en enviar/verificar: una operación en vuelo, sin SMS duplicados.
4. Timeout de solicitud conserva `requestId`; otro número/tipo no reutiliza ese ID.
5. Reenvío explícito respeta cooldown y 429; temporizador correcto después de background.
6. Verificación con respuesta perdida no navega a la app sin credenciales.
7. Inicio offline conserva credenciales sin declarar autorización del servidor.
8. Varias peticiones protegidas disparan una sola renovación y usan el token nuevo.
9. Un 401 tardío de una petición antigua no provoca una segunda rotación innecesaria.
10. Timeout/pérdida de respuesta de refresh y cierre del proceso durante persistencia.
11. Logout/cambio de cuenta mientras refresh/login están pendientes no restaura el usuario anterior.
12. Revocación remota y vencimiento absoluto limpian sesión; no se salta OTP con un `deviceId` conocido.
13. Reinicio, actualización normal, reinstalación y restauración de backup en Android/iOS.
14. Google sin `session` permanece en inscripción; vincular obtiene la misma cuenta.
15. Socket con token nuevo tras refresh, sin listeners duplicados ni eventos de otro usuario.
16. Login móvil no permite el panel Vue; conductor pendiente no se considera aprobado.
17. Biometría cancelada/no disponible; no se traduce en una prueba de servidor.
18. Fuera de cohorte o con proveedor indisponible: pantalla recuperable sin bucles de SMS.

## 14. Activación

Primero integrar y probar sin saldo SMS. Después usar staging y un número de
aceptación autorizado, con `PHONE_SMS_PROVIDER=inalambria`, porcentaje cero y
lista explícita en backend. La activación para usuarios se controla por configuración
del servidor; una bandera Flutter no autoriza por sí sola a enviar SMS.

Medir errores por etapa, latencia, renovaciones y cierres sin incluir teléfono,
códigos ni tokens en métricas. Ampliar la cohorte después de revisar consumo y
tasas de verificación. Para retirar nuevos envíos, porcentaje cero y lista vacía
en backend mantienen la renovación de sesiones existentes.

Esta guía describe la implementación a realizar en Flutter. Sus ejemplos son
de contrato y diseño; no sustituyen las pruebas de compilación y dispositivo en
el repositorio de la app. Las versiones de paquetes y la configuración nativa
deben verificarse allí antes de publicar.
