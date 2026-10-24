# Contrato de autenticación para Flutter

Guía de desarrollo por etapas: [implementación en Flutter](flutter-implementation-guide.md).

## Endpoints

Todos los cuerpos son JSON. Tokens y códigos nunca deben ir en URL o logs.

| Método/ruta | Autorización | Entrada principal | Resultado |
|---|---|---|---|
| `POST /api/auth/phone/request-otp` | Público | `phoneNumber`, `deviceId`, `requestId`, `accountType` opcional | `challengeId`, `expiresIn`, `retryAfter`, `deliveryStatus` |
| `POST /api/auth/phone/verify-otp` | Público | `challengeId`, `code`, `deviceId`, `device`, `rememberMe`, `registration` opcionales | Usuario, tokens, sesión e `isNewUser` |
| `POST /api/auth/phone/link/request-otp` | Access token de la cuenta existente | Igual que solicitar OTP | Desafío ligado al usuario y propósito de vinculación |
| `POST /api/auth/phone/link/verify-otp` | Mismo usuario autenticado | Igual que verificar OTP | Misma cuenta y una sesión móvil con tokens |
| `POST /api/auth/refresh` | Refresh token en el cuerpo | `refreshToken`, `deviceId` original | Tokens rotados, mismo identificador de sesión |
| `POST /api/auth/logout` | Refresh token en el cuerpo | `refreshToken` | Revoca esa sesión/familia |
| `POST /api/auth/logout-all` | Access token | Sin cuerpo necesario | Revoca todas las sesiones, incluida la actual |
| `GET /api/auth/me` | Access token | — | Usuario actual |
| `POST /api/auth/google` | Prueba Google en el cuerpo | `idToken` | Cuenta sin teléfono: tokens de inscripción; cuenta ya verificada: requiere OTP |
| `POST /api/auth/login` | Credenciales en el cuerpo | `email`, `password` | Admin/operador: login actual; móvil sin teléfono verificado: inscripción; móvil verificado: requiere OTP |
| `POST /api/auth/forgot-password` | Público | `email` | Respuesta genérica; correo simulado en pruebas |
| `POST /api/auth/reset-password` | Token recibido por correo | `token`, `password` | Consumo único, cambio de contraseña y revocación de sesiones |

Ejemplos completos: [OTP](phone-auth.md) y [sesiones](mobile-sessions.md).
Los únicos tipos de registro móvil son `client` y `driver`. El conductor nuevo
requiere licencia y datos del vehículo; verificar teléfono no aprueba su perfil.

## Estados de Flutter

1. **Sin sesión:** crear/conservar `deviceId` UUID v4 por instalación.
2. **Solicitando código:** generar `requestId` UUID v4 por envío deliberado.
3. **Esperando OTP:** guardar `challengeId` y cuenta regresiva según `expiresIn`.
   `deliveryStatus=sent` significa aceptación del proveedor, no entrega al celular.
   `pending` indica que el primer despacho sigue en proceso; consultar reintentando
   con el mismo `requestId`, sin generar otro SMS.
4. **Autenticado:** reemplazar credenciales y guardar refresh token en almacenamiento
   seguro. Conservar también `session.id` y `installationId`.
5. **Renovando:** una sola solicitud de refresh a la vez, compartida por las peticiones
   pendientes. Reemplazar el refresh token antes de permitir la siguiente renovación.
6. **Reautenticación:** si no hay refresh válido, instalación no coincide o la sesión
   fue revocada/venció, limpiar credenciales y volver al OTP.

Si Google/correo devuelve tokens sin `session`, la cuenta solo puede consultar
`/me`, cerrar todas las sesiones o completar la vinculación del teléfono. No se
debe mostrar la app como autenticada para viajes hasta completar el OTP.

## Errores y reintentos

| HTTP/código | Interpretación | Acción Flutter |
|---|---|---|
| 400 | Entrada inválida o perfil de conductor incompleto | Corregir campos; no enviar otro SMS automáticamente |
| 401 en verificar OTP | Código incorrecto, vencido, consumido o desafío/cuenta incompatible | Mantener mensaje genérico; permitir corrección o reenvío deliberado cuando el servidor lo permita |
| 401 `OTP_REQUIRED` | No existe una sesión móvil autorizada | Volver al flujo OTP |
| 401 en refresh/HTTP protegido | Credencial, instalación o sesión inválida/vencida/revocada | Intentar refresh solo si corresponde y una sola vez; si falla, limpiar credenciales |
| 403 `ADDITIONAL_FACTOR_REQUIRED` | Política de protección adicional del servidor | No sustituirla por biometría local ni reenviar SMS; el verificador adicional aún está pendiente |
| 403 en rutas administrativas | Rol sin permiso | No mostrar acceso al panel ni reintentar con otro rol |
| 409 | Conflicto de identidad o datos únicos | No fusionar cuentas automáticamente ni modificar identificadores de usuario |
| 429 | Límite de intentos/envíos | Respetar `Retry-After` y `retryAfter` cuando estén presentes |
| 503 | Cohorte deshabilitada, configuración, proveedor o estado incierto | Mostrar indisponibilidad; no iniciar otro envío con un nuevo identificador automáticamente |

Un error de red después de solicitar SMS no demuestra que el proveedor no lo
envió. Reutilizar el mismo `requestId` para consultar/reintentar esa operación.
Solo un reenvío explícito del usuario genera otro `requestId`. Los estados
desconocidos o pendientes bloquean nuevos SMS al número hasta vencer el desafío.

OTP: cinco minutos y cinco fallos máximos por desafío. Envíos: mínimo sesenta
segundos y máximo tres por teléfono/hora móvil. También aplican cuotas por
dispositivo/IP y globales. No asumir que el cooldown local autoriza el envío:
la respuesta del servidor manda.

## Ciclo de vida y Socket.IO

El access token lleva `sid`; la sesión y su familia son independientes por
instalación. Renovar no requiere SMS. El máximo absoluto por defecto es treinta
días, configurable; `rememberMe` no puede ampliarse después de crear la sesión.

Reutilizar un refresh token rotado revoca su familia. Si se pierde una respuesta
de refresh, no existe recuperación idempotente de ese token: puede requerirse OTP.
No persistir credenciales en logs, preferencias sin protección o copias de respaldo.
Una reinstalación debe generar otro `deviceId` y descartar credenciales anteriores.

Socket.IO conecta con `auth: { token: accessToken }`. Al expirar ese JWT, obtener
otro por refresh y reconectar con el nuevo token. El servidor desconecta sesiones
revocadas después del commit; la emisión se propaga con el adaptador Redis cuando
está configurado. Una verificación periódica de base de datos detecta revocaciones
externas incluso sin actividad del cliente (cinco segundos por defecto).

## Recuperación y cambios de número

- Si conserva acceso al mismo número, verificar OTP desde otra instalación recupera
  la misma cuenta sin duplicarla. Las otras sesiones siguen independientes; cerrar
  todas invalida también la actual.
- Las cuentas con contraseña pueden usar recuperación por correo. El token caduca
  y solo un reset concurrente puede consumirlo. El cambio revoca las sesiones móviles
  y refresh tokens, y desconecta los sockets móviles asociados.
- El cambio reforzado de un número ya verificado **no está implementado**. Las rutas
  de vinculación lo rechazan y no envían SMS a modo de sustitución.
- Recuperar una cuenta sin el número anterior ni otro factor verificado tampoco
  tiene flujo implementado. No crear otra cuenta ni cambiar el teléfono por soporte
  sin un proceso de recuperación definido.
- Passkeys y verificación biométrica de servidor siguen pendientes; la política
  adicional preparada bloquea nuevos accesos si se activa antes de implementarlas.
