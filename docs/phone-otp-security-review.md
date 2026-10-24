# Revisión de seguridad de SMS OTP de GotTaxi

## Alcance y archivos

Rutas públicas: `POST /api/auth/phone/request-otp` y
`POST /api/auth/phone/verify-otp`. Se añadieron las variantes autenticadas
`/api/auth/phone/link/request-otp` y `/api/auth/phone/link/verify-otp` para
asociar un teléfono a una cuenta existente sin registrar otra identidad.
Se revisaron también `/api/auth/signup` y `/api/auth/google` por sus interacciones
con las cuentas móviles.

Archivos principales:

- `src/modules/auth/models/phone-otp.model.js`: cuotas, reserva, idempotencia,
  bloqueo del proveedor, bloqueo de fila y consumo de OTP.
- `src/modules/auth/services/phone-auth.service.js`: generación/HMAC, Colombia,
  contexto de dispositivo, cuentas y vinculación explícita.
- `src/modules/auth/services/inalambria-sms.service.js`: Bearer, respuesta,
  timeout, clasificación de fallos, ausencia de reintentos y errores saneados.
- Middleware, controlador y rutas de autenticación telefónica: contrato y errores.
- `src/modules/auth/utils/phone-auth-context.js`: contexto UUID e IPv6 /64.
- `src/modules/auth/services/auth.service.js`: impedir reservas por correo sin
  verificar y auto-vinculación Google mediante correo local no verificado.
- `src/modules/auth/models/auth.model.js`: bloqueo de la cuenta durante OTP.
- `src/middleware/request-logger.middleware.js`: excluir query strings y
  validar identificadores de correlación que provienen del cliente.
- `src/config/env.js`, ejemplos de entorno y
  `migrations/20261026_harden_phone_otp_sending.js`.
- Pruebas de OTP, cuentas por teléfono y Google.

## Hallazgos corregidos

| Prioridad | Hallazgo | Corrección |
|---|---|---|
| Alta | Se permitían tres SMS cada quince minutos, sin límite por dispositivo ni tope global de ráfaga. El cupo global inicial era de 1000 SMS/24 h y no tenía alertas. | Tres por hora por teléfono y dispositivo; ventanas móviles; diez por minuto y cien por 24 h globales por defecto; alertas estructuradas al 80 % y al agotarse. |
| Alta | Cambiar IP/dispositivo permitía gastar el cupo global rápidamente; IPv6 se podía rotar por interfaz. | Reserva global serializada en PostgreSQL, límite por minuto además del diario e IPv6 /64. El cupo global aplica aunque roten todos los identificadores del cliente. |
| Alta | No había idempotencia de negocio; un reintento podía transformarse en otro envío tras el cooldown. | UUID `requestId` único persistido antes del despacho, vinculado al dispositivo, número, tipo, propósito y usuario cuando corresponde. Los reintentos concurrentes conservan el mismo desafío y no despachan otra vez. |
| Alta | Timeouts/estados ambiguos se trataban como fallos genéricos, sin política compartida para reenvíos. | Estado `unknown` o `pending` conservado; sin reintentos automáticos ni liberación de cupo; bloqueo al teléfono hasta que venza el desafío. |
| Alta | Un teléfono no verificado en una cuenta con credenciales podía habilitar acceso público mediante OTP y mezclar factores de identidades sin prueba previa. | El contacto no verificado no autoriza login. La asociación exige sesión de la cuenta existente y OTP en rutas separadas, con propósito/usuario vinculados al desafío. No se fusionan cuentas ni se reemplaza un número verificado. |
| Alta | Google podía auto-vincular una cuenta local cuyo correo no había sido verificado, incluida una carrera de registro. | Verificación del estado local y correo tanto en búsqueda inicial como después de creación concurrente. |
| Alta | `/signup` por correo podía reservar un celular ajeno sin OTP y bloquear el registro de su dueño. | Rechazo de `phoneNumber` en ese registro público; se exige registro OTP o vinculación autenticada posterior. |
| Media | No existía corte compartido ante credenciales inválidas, saldo agotado o límites del proveedor. | Circuito compartido de quince minutos ante 401/402/403/429 y alerta sin datos sensibles. |
| Media | La vigencia podía evaluarse antes de adquirir un bloqueo de fila y quedar desactualizada durante la espera. | Consulta explícita del reloj PostgreSQL después de adquirir el bloqueo. |
| Media | El contador del desafío incluía códigos correctos rechazados después por rol/estado; logs podían incluir query strings o detalles personales de errores SQL. | Solo los códigos incorrectos incrementan fallos del desafío. Se conserva además un presupuesto agregado de verificación. Logs sin query strings y errores internos OTP genéricos. |
| Media | La validación aceptaba teléfonos colombianos fijos para un flujo de acceso SMS. | E.164 más validación de móvil colombiano de diez dígitos que comienza por 3; destinos limitados inicialmente a CO. |

## Comprobación de los catorce requisitos

| N.º | Resultado |
|---|---|
| 1 | `crypto.randomInt(0, 1000000)` y relleno hasta seis dígitos, incluyendo ceros iniciales. |
| 2 | HMAC-SHA256 con secreto de servidor, UUID del desafío, número, tipo de cuenta, propósito y usuario destinatario de la vinculación. Sin OTP plano en tablas ni logs. |
| 3 | Cinco minutos, controlados con reloj de PostgreSQL y comprobación después de obtener el bloqueo. |
| 4 | Cinco fallos por desafío, actualización dentro de la transacción. Presupuesto adicional de cinco verificaciones por teléfono en quince minutos; reenvíos no lo reinician. |
| 5 | Cuotas compartidas por teléfono, IP, dispositivo y globales. Todas se reservan bajo el mismo bloqueo antes de despachar. IPv6 /64. |
| 6 | Sesenta segundos y tres envíos por teléfono en cualquier ventana móvil de una hora. |
| 7 | Límite global por minuto y 24 h; todas las reservas cuentan, incluso envíos fallidos o ambiguos. Eventos de alerta al 80 %/agotamiento y bloqueo del proveedor. |
| 8 | Bloqueo del desafío y transacción común para crear/verificar cuenta, emitir refresh token y consumir el código. Las llamadas concurrentes solo crean una sesión. |
| 9 | Timeout de dieciocho segundos, cero reintentos automáticos, idempotencia local, conservación del estado desconocido y del presupuesto. |
| 10 | Bearer API key confirmado contra OpenAPI oficial. La especificación consultada no documenta expiración ni endpoint de renovación; no se implementa un refresh inventado. Ante rechazo, detener envíos y revisar/rotar credencial. |
| 11 | Normalización E.164 y restricción de móviles colombianos; el proveedor recibe un solo destinatario. |
| 12 | Solicitar un código no busca cuentas. Fallos de verificación genéricos, sin revelar identidad. Logs sin cuerpo de SMS, códigos, API keys, query strings ni detalles SQL personales. |
| 13 | Reutilización de cuentas móviles con factor válido; verificación explícita desde cuentas Google/correo con contacto sin verificar; Google exige correo verificado local. Unicidad de teléfono y ausencia de fusiones automáticas. |
| 14 | Pruebas unitarias y reales de transacciones/concurrencia en esquema temporal, con transporte SMS simulado. |

## Contrato y operación

Flutter debe enviar un `deviceId` UUID v4 persistente de instalación y un
`requestId` UUID v4 por envío deliberado. Un reintento de red conserva ese
`requestId`. La verificación incluye el mismo `deviceId`. Consultar
[el contrato completo](phone-auth.md).

`deviceId` no es prueba de hardware y puede rotarse. La protección económica
frente a ataques distribuidos depende de los límites globales, no de confiar en
ese valor. Un bot todavía puede agotar el cupo autorizado y afectar disponibilidad;
el límite de SMS no es un presupuesto monetario ni una garantía de entrega.
Configurar el cupo según el precio y el saldo contratado, y conectar los eventos
`phone_otp_sms_budget_alert` y `phone_otp_sms_provider_blocked` al monitoreo para
recibir notificaciones. No se han enviado notificaciones externas desde esta revisión.

Conservar el registro de idempotencia y al menos las últimas 24 horas de reservas;
una limpieza que borre ese estado puede reabrir cuotas o reutilizar identificadores.
No ejecutar reenvíos de estados pendientes/desconocidos desde jobs de recuperación.
La migración deja inválidos los desafíos anteriores que carecen de contexto de
dispositivo; solicitar uno nuevo después del despliegue.

No es posible deducir que una cuenta sin correo y otra sin teléfono pertenecen a
la misma persona. Flutter debe usar el flujo autenticado de vinculación para
asociar esos factores. Cualquier fusión de dos cuentas existentes requiere un
proceso explícito distinto y no forma parte de esta revisión.

## Validación ejecutada

- `npm test`: 186 pruebas aprobadas; la prueba contenedora de integración se omite por defecto y se ejecutó aparte. Sin llamadas SMS reales.
- `RUN_PHONE_OTP_DB_TESTS=1 node --test tests/auth.phone-otp.integration.test.js`:
  veinte escenarios de integración aprobados en esquema PostgreSQL aislado;
  el runner cuenta además el contenedor padre como una prueba (21 en total).
- Cobertura: consumo único y sesiones concurrentes; cinco fallos simultáneos;
  caducidad, incluida espera por bloqueo; rollback si falla la emisión de tokens;
  reemplazo/repetición; cooldown; tres SMS/hora con IP/dispositivos distintos;
  cuota por dispositivo; IPv6 /64; ráfaga global distribuida; idempotencia concurrente
  y después de cooldown; timeout sin reenvío; corte compartido del proveedor;
  vinculación de cuenta Google sin duplicación; alertas y ausencia de datos sensibles.
- `git diff --check`: sin errores de whitespace.

Fuentes del proveedor: [documentación](https://api.inalambria.express/docs/) y
[especificación OpenAPI](https://api.inalambria.express/docs/openapi.json).
