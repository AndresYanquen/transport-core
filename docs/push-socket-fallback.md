# Invitaciones: Socket.IO primero, FCM como respaldo

## Comportamiento implementado

Se aplica exclusivamente a invitaciones `ride.invite`. Estados de viaje, pánico y mensajes internos mantienen el comportamiento de envío previo.

1. Después del commit del viaje, se persiste el respaldo por instalación antes de emitir `ride:invite-created`.
2. Socket.IO recibe `eventId` y `schemaVersion` adicionales, sin eliminar campos anteriores. El identificador coincide exactamente con `data.eventId` de FCM.
3. Cada entrega espera dos segundos por defecto si la instalación está en foreground, tiene presencia caducada o no reportó visibilidad. Un reporte reciente de background elimina esa espera inicial para esa instalación.
4. Si Flutter confirma que presentó la tarjeta en foreground antes de la reserva de despacho, esa entrega pasa a `suppressed` y no se llama a FCM para ella.
5. Sin confirmación, se revalidan sesión, registro, invitación, vigencia y elegibilidad, y se intenta FCM.

La espera se representa en `available_at` de PostgreSQL: no se usa `sleep`, no se mantienen transacciones abiertas durante dos segundos ni se retiene el request esperando a Flutter. Se conserva el encolado best effort posterior al commit y su ventana conocida de pérdida ante una caída antes del encolado.

Un reporte de foreground no acredita por sí solo que se haya presentado una tarjeta y nunca suprime push. La confirmación es una declaración del cliente autenticado; el servidor no verifica visualmente la pantalla, lectura ni atención humana. No significa aceptar el viaje.

## Migración y configuración

Migración incremental: `20261030_add_push_invitation_fallback.js`, posterior a `20261029_create_push_devices_and_deliveries.js`.

Añade:

- Dispositivo: `app_visibility`, `visibility_reported_at`, `visibility_valid_until`.
- Entrega: `presented_at`, `dispatch_started_at` y estado terminal `suppressed`.

La presencia se reinicia a `unknown` y sus fechas a null cuando cambia el token, la sesión o la versión de seguridad, o se reactiva un registro deshabilitado. Una renovación idempotente del mismo registro conserva su presencia. Se usan fechas del servidor; el cliente no elige la vigencia.

```env
PUSH_WORKER_INTERVAL_MS=500
PUSH_INVITATION_ACK_WAIT_MS=2000
PUSH_VISIBILITY_TTL_SECONDS=40
```

El worker acepta intervalos de 100 a 60000 ms. La espera de ACK está limitada entre 0 y 10000 ms; la vigencia de presencia entre 10 y 120 segundos. Valores explícitos anteriores como `PUSH_WORKER_INTERVAL_MS=5000` deben actualizarse en el despliegue para aprovechar la menor latencia.

Los dos segundos son una ventana de espera inicial, no un SLA de entrega. El polling, volumen de cola, DB, red y proveedor añaden latencia. La vigencia de la invitación sigue siendo `PUSH_INVITE_TTL_SECONDS` (60 s por defecto), y se descartan eventos vencidos. Esta funcionalidad no amplía los 90 s de presencia del conductor ni sustituye una ubicación reciente.

## Identidad de la invitación

Socket.IO sigue usando `ride:invite-created`:

```json
{
  "eventId": "invite:UUID_INVITACION:2026-10-27T20:00:00.000Z",
  "schemaVersion": "1",
  "rideId": "UUID_VIAJE",
  "invite": { "id": "UUID_INVITACION", "driverId": "UUID_CONDUCTOR", "status": "pending", "invitedAt": "2026-10-27T20:00:00.000Z" },
  "ride": { "id": "UUID_VIAJE", "status": "pending_driver" },
  "emittedAt": "2026-10-27T20:00:00.000Z"
}
```

Ejemplo resumido: `ride` conserva el objeto que ya enviaba el evento. Copiar `eventId` tal como llega; no reconstruirlo desde IDs ni sustituirlo por el ID de mensaje del proveedor. Una nueva invitación que reutiliza una fila con otra fecha tiene otro identificador.

## Reportar visibilidad

Solo conductores con sesión móvil completa (`sid`), incluidos clientes Flutter web autenticados por ese flujo. Registrar el dispositivo antes de reportar presencia. No aplica a tokens de inscripción ni a sesiones administrativas sin instalación móvil.

HTTP:

```http
PATCH /api/push/devices/presence
Authorization: Bearer <access token>
Content-Type: application/json
```

```json
{ "visibility": "foreground" }
```

Valores: `foreground`, `background`, `unknown`. Puede enviarse `installationId`, pero debe coincidir con la instalación de la sesión; si se omite, la determina el backend. `userId` y `sessionId` del body no se usan para autorizar.

Respuesta 200:

```json
{
  "visibility": "foreground",
  "reportedAt": "2026-10-27T20:00:00.000Z",
  "validUntil": "2026-10-27T20:00:40.000Z"
}
```

Alternativa Socket.IO: emitir `push:presence` con el mismo body y callback de respuesta. El callback incluye `{ "ok": true, ...respuesta }` o `{ "ok": false, "status": 400, "message": "..." }`. El socket usa la autenticación JWT existente. Se requiere callback; sin él no se procesa esta operación.

Flutter debe reportar tras registrar/restaurar sesión, al cambiar el lifecycle y aproximadamente cada 15 segundos mientras esté visible. Elegir un canal principal y serializar los reportes; evitar enviar indiscriminadamente por HTTP y socket a la vez. Si no puede reportar al suspenderse, la visibilidad anterior caduca. El servidor considera unknown una presencia vencida al decidir la espera, aunque el valor histórico de `app_visibility` permanezca guardado.

Reportar visibilidad no actualiza ubicación ni `drivers.last_seen_at`, y no mantiene por sí solo al conductor elegible para viajes.

## Confirmar que se presentó la tarjeta

Flutter debe enviar la confirmación después de presentar la invitación mediante Socket.IO, mientras la app siga en foreground. No confirmarla automáticamente al recibir el paquete, desde el handler de background o antes de que la UI esté disponible.

Evento recomendado: `ride:invite-presented`, con callback:

```json
{
  "eventId": "invite:UUID_INVITACION:2026-10-27T20:00:00.000Z",
  "visibility": "foreground"
}
```

Respuesta si se suprimió el respaldo de esta instalación:

```json
{ "ok": true, "recorded": true, "suppressed": true, "presentedAt": "2026-10-27T20:00:01.000Z" }
```

Alternativa HTTP para el mismo contrato:

```http
POST /api/push/invitations/presented
Authorization: Bearer <access token>
Content-Type: application/json
```

Devuelve 200 con los mismos campos, sin `ok`. HTTP y socket comparten la misma operación persistida; repetirla es idempotente. Se valida el identificador, visibilidad foreground, propietario, sesión, versión de registro, vigencia y ocurrencia actual de la invitación.

Si no existe una entrega vigente para esa instalación, devuelve:

```json
{ "recorded": false, "suppressed": false, "reason": "not_pending_for_installation" }
```

Es una respuesta normal para una invitación vencida/cambiada, un respaldo que no se creó o que pertenece a otro registro. No aceptar el viaje ni mostrar errores bloqueantes por este resultado.

Si el despacho ya se reservó, la confirmación queda registrada pero no promete cancelar el envío en curso:

```json
{ "recorded": true, "suppressed": false, "reason": "dispatch_already_started", "presentedAt": "2026-10-27T20:00:02.100Z" }
```

Si ese envío falla temporalmente, la confirmación impide programar otro intento. Si FCM lo acepta, queda `accepted`, con la confirmación registrada aparte.

Errores: 400 payload o instalación inválidos; 401 sesión expirada/revocada; 403 rol/sesión no habilitados; 404 al reportar presencia sin registro activo; 429 límite; 503 persistencia temporalmente no disponible. No se exponen tokens ni detalles SQL.

HTTP: dispositivos mantienen 30 peticiones/minuto por usuario; presencia tiene 60 y confirmaciones 120 por usuario/sesión, en contadores independientes y con Redis cuando está configurado. Socket: límites por conexión de 60 reportes de presencia y 120 confirmaciones/minuto, además de las comprobaciones de sesión existentes. El límite de socket es local a esa conexión, no un contador global distribuido.

## Concurrencia y varias instalaciones

La confirmación y la reserva final de despacho actualizan la misma fila PostgreSQL:

- Si gana la confirmación, la reserva no devuelve esa entrega y el worker no la envía.
- Si gana la reserva, la confirmación informa `dispatch_already_started`.
- Si la confirmación llega entre claim y reserva, todavía puede suprimir el aviso.
- Un worker con un lease antiguo no puede cerrar la entrega de otro worker.

La reserva es la frontera de cancelación. Incluye una revalidación del registro, sesión, usuario, vencimiento y versión antes de obtener el token para enviar. La invitación se comprueba en el worker antes de esa reserva. Un cambio posterior en el viaje, la app o la red no permite retirar un mensaje en tránsito; Flutter debe seguir reconciliando estado y deduplicando presentación por `eventId`.

La confirmación suprime exclusivamente la entrega de esa instalación/sesión/versión. Otros teléfonos del mismo usuario conservan sus respaldos. Los clientes antiguos que no reportan ni confirman continúan recibiendo FCM tras la espera.

## Flutter pendiente y pruebas de aceptación

El código Flutter no está en este repositorio. Debe añadirse allí:

1. Reportes del lifecycle por instalación y señal periódica mientras esté visible.
2. Leer el `eventId` agregado a `ride:invite-created`.
3. Confirmar después de presentar la tarjeta, con la app visible y sin aceptar el viaje.
4. Deduplicar la presentación entre FCM/Socket.IO; una pulsación posterior debe seguir abriendo el recurso.
5. Manejar pérdida del ACK, cambio de cuenta, reconexión y sesión revocada; un ACK perdido puede producir el respaldo FCM.

La integración PostgreSQL automatizada usa esquemas temporales y FCM simulado. Comprueba presencia fresca/caducada, dos instalaciones, idempotencia, aislamiento, rotación, revocación, ACK antes/después del despacho, carreras concurrentes, reintentos, socket real autenticado, API HTTP, igualdad de `eventId` y rollback incremental.

Prueba manual en staging: foreground con tarjeta presentada sin push; foreground sin ACK con push de respaldo; background con push sin espera inicial; reconexión sin ACK oportuno; dos instalaciones donde solo una confirma; invitación aceptada/cancelada/vencida antes de enviar. Verificar logs `push_invitation_presentation`, estado `suppressed` y resultado de proveedor por separado. La supresión representa una presentación declarada, no una métrica de lectura.

## Activación y rollback

Aplicar ambas migraciones en el entorno autorizado antes de ejecutar esta versión. Desplegar primero backend, con el intervalo actualizado; después Flutter. No hay despliegue automático ni migraciones sobre tablas de producción en esta entrega.

Para volver al envío sin margen inicial se puede configurar `PUSH_INVITATION_ACK_WAIT_MS=0` y reiniciar; esto no desactiva la capacidad de confirmar antes de una reserva. Para apagar el canal completo, usar `PUSH_ENABLED=false`. Un rollback del binario a una versión anterior requiere revertir también la migración incremental, con todos los workers nuevos detenidos: convierte `suppressed` a `discarded`, elimina las columnas nuevas y conserva las tablas iniciales. No revertir migraciones ajenas ni borrar datos sin el procedimiento de despliegue habitual.

## Resultado de validación de esta entrega

- `npm test`: 229 pruebas correctas, cero fallos y cuatro suites opt-in omitidas.
- `npm run test:push:integration`: 24 escenarios correctos (26 pruebas incluyendo los dos contenedores del runner), con PostgreSQL local en esquemas aleatorios que se eliminan al terminar.
- Se probó HTTP y un cliente Socket.IO real autenticado; las llamadas de envío Firebase fueron simuladas.
- No se realizaron envíos reales, cambios en Flutter ni despliegues.
