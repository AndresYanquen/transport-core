# Validación y activación de autenticación móvil

## Resultado y alcance

Se prueban el código y las rutas reales de GotTaxi, con PostgreSQL en un esquema
temporal aislado y un proveedor SMS simulado. Las pruebas de red levantan HTTP
y Socket.IO locales. No se envían SMS ni correos reales, no se modifica una
cuenta de producción y no se publica un despliegue externo.

Ejecución final del 24 de octubre de 2026:

- `npm test`: 195 aprobadas, cero fallos y un contenedor de integración omitido
  por defecto.
- `npm run test:auth:integration`: 42 escenarios hoja aprobados; el runner muestra
  44 pruebas contando sus dos contenedores. Incluye diez casos de red HTTP/Socket.IO.
- `git diff --check`: sin errores.
- Cero envíos reales de SMS/correo. La configuración local usa mock y una cohorte
  de prueba; no se activó ni desplegó producción.

### Matriz de cobertura

| Área | Comprobación |
|---|---|
| OTP | Incorrecto, vencido, consumido, mismo código reutilizado, máximo cinco fallos y comprobación del reloj después de esperar un bloqueo |
| Concurrencia | Dos verificaciones: una sesión; múltiples fallos: cinco; doce solicitudes distribuidas: dos envíos con un cupo global de dos |
| Duplicados | Idempotencia simultánea y después del cooldown; unicidad entre pasajero/conductor; Google concurrente crea un usuario/proveedor |
| Costos | Ventanas móviles, teléfono, dispositivo, IP/IPv6, cupos globales, alertas, estados desconocidos y circuito del proveedor |
| Sesiones | Instalaciones independientes, familia/JWT vinculados, renovación sin SMS, caducidad absoluta, `rememberMe` del servidor y rollback |
| Revocación | HTTP devuelve 401, Socket.IO rechaza reconexión y desconecta sockets inactivos en logout, logout-all, reemplazo y recuperación |
| Cambios externos | Revocar en SQL desconecta el socket mediante comprobación periódica |
| Expiración JWT | HTTP y Socket.IO rechazan desde el segundo exacto `exp` |
| Recuperación | OTP en otra instalación recupera la misma cuenta; enlace de contraseña vencido/repetido/concurrente, consumo único y revocación |
| Cambio de número | La vinculación no reemplaza un número verificado ni genera un SMS para hacerlo; endpoint de cambio aún ausente |
| Roles | Admin/operador conservan login por contraseña y permisos; pasajero/conductor reciben 403 en administración; el registro OTP no admite admin |
| Google | Inscripción limitada, vinculación OTP a la misma cuenta, bloqueo de correos sin verificar y carreras de identidad |
| Activación | Fuera de cohorte no reserva cupo ni despacha; sesiones existentes siguen renovándose |
| Datos sensibles | Sin códigos, tokens, API keys ni cuerpos del proveedor en logs/HTTP; mock solo en memoria y prohibido en producción |

## Correcciones surgidas de las pruebas

- El validador JWT usaba `now > exp`, aceptando el token durante el segundo exacto
  de vencimiento. Ahora exige expiración numérica y aplica `now >= exp`.
- Un socket inactivo podía seguir conectado tras revocar su sesión. Se incorporó
  un evento de revocación **después del commit**, sala por sesión y desconexión
  mediante Socket.IO. Un control periódico detecta además cambios de otro proceso
  o hechos directamente en SQL. Los temporizadores se limpian al desconectar.
- El reemplazo de instalación solo desconecta la sesión anterior si la transacción
  OTP confirma; un fallo de emisión de tokens preserva su sesión/socket.
- La recuperación de contraseña ahora bloquea el token y confirma consumo,
  cambio de contraseña y revocación en una sola transacción. Dos peticiones
  concurrentes no pueden aplicar dos contraseñas distintas.
- Se añadió proveedor mock de desarrollo y una barrera que impide al dispatcher
  usar SMS reales bajo el runner de pruebas. El adaptador Inalambria se comprueba
  unitariamente con transporte simulado, nunca contra destinatarios reales.

## Comandos reproducibles

```sh
npm test
npm run test:auth:integration
git diff --check
```

La segunda prueba usa las variables de una base de desarrollo/pruebas. El usuario
PostgreSQL necesita crear/eliminar un esquema temporal; la prueba aplica las
migraciones ahí y elimina ese esquema al terminar. No apuntar las pruebas a la
base de producción. Se necesita poder abrir puertos HTTP locales.

La suite general omite por defecto el contenedor de integración; este se ejecuta
con el segundo comando. Contar escenarios hoja por separado de los contenedores
del runner evita presentar un número inflado de casos.

## Activación progresiva

Configuración inicial de desarrollo:

```dotenv
PHONE_AUTH_ENABLED=true
PHONE_SMS_PROVIDER=mock
PHONE_AUTH_ROLLOUT_PERCENT=0
PHONE_AUTH_ALLOWED_NUMBERS=+573001112233
PHONE_OTP_GLOBAL_MINUTE_LIMIT=10
PHONE_OTP_GLOBAL_DAILY_LIMIT=100
SOCKET_SESSION_CHECK_INTERVAL_MS=5000
```

El ejemplo de número es ilustrativo; la lista local se configura en `.env`,
no en archivos versionados. `takeMockOtp` es una utilidad interna del proceso
de desarrollo/pruebas, no un endpoint ni un código fijo. El mock no requiere
API key y nunca escribe códigos en SQL o archivos ni los devuelve por HTTP.

Para staging/producción:

1. Ejecutar las suites y aplicar `npm run migrate:latest` antes de iniciar el código.
2. Usar `PHONE_SMS_PROVIDER=inalambria`, API key y secreto HMAC independiente;
   mantener `PHONE_AUTH_ENABLED=false` hasta revisar la configuración.
3. Activar `PHONE_AUTH_ENABLED=true`, porcentaje cero y solo una lista explícita
   de números E.164 para la prueba de aceptación. No añadir envíos reales a CI.
4. Después de comprobar proveedor, recepción y métricas, aumentar gradualmente
   `PHONE_AUTH_ROLLOUT_PERCENT` (por ejemplo 5, 25 y 100), reiniciando la app para
   cargar el entorno. El grupo se calcula por HMAC del teléfono y es estable con
   el mismo secreto; cambiar `deviceId` no altera su inclusión.
5. Mantener las cuotas económicas. Conectar `phone_otp_sms_budget_alert` y
   `phone_otp_sms_provider_blocked` al monitoreo, y revisar errores 429/503,
   latencia, aceptaciones del proveedor y validaciones OTP antes de ampliar.

Producción rechaza `PHONE_SMS_PROVIDER=mock` al arrancar y al usar el servicio.
Los límites globales se miden en SMS/reservas, no en moneda: ajustarlos según
saldo y precio contratado. Un atacante distribuido aún puede agotar el cupo
permitido; las cuotas evitan superar ese cupo por concurrencia.

Para detener nuevos SMS sin interrumpir sesiones válidas, establecer porcentaje
cero y vaciar la lista permitida. Los desafíos ya emitidos pueden verificarse
hasta vencer. `PHONE_AUTH_ENABLED=false` bloquea también solicitud/verificación
OTP, pero no invalida refresh tokens por sí solo. No borrar el historial de
idempotencia/cuotas como mecanismo de rollback. Corregir proveedor/saldo antes
de reactivar un circuito abierto; no reenviar estados `pending`/`unknown`.

La propagación real del adaptador Redis con varios servidores, el API key real
y la recepción en un operador móvil requieren aceptación en staging; las pruebas
automatizadas descritas usan sockets locales y no consumen saldo Inalambria.

## Pendientes expresos

El cambio reforzado de teléfono y la recuperación sin acceso al número anterior
no están implementados: solo se prueban los bloqueos para impedir una sustitución
insegura. Passkeys/biometría verificable por servidor tampoco están implementadas;
activar la política adicional preparada bloquea nuevos accesos.

Contrato para Flutter: [endpoints, estados, errores y tokens](flutter-auth-contract.md).
