# Plan: Socket.IO primero y FCM de respaldo para invitaciones

## Objetivo

Suprimir el push de una instalación únicamente cuando Flutter confirma que presentó la invitación en primer plano. Un socket conectado o un reporte de foreground, por sí solos, no suprimen el aviso. No cambiar matching, aceptación de viajes ni los eventos de estados/pánico.

## Implementación prevista

1. Migración incremental de presencia por dispositivo y confirmación/despacho por entrega. Estado terminal `suppressed`, diferenciado de `accepted` por FCM.
2. Reportes autenticados de `foreground`/`background`/`unknown`, con fecha de servidor y caducidad por instalación. Reiniciar presencia al rotar token o sesión.
3. Compartir el mismo `eventId` entre Socket.IO y FCM. Crear el respaldo persistente antes de emitir el evento. Retrasar invitaciones dos segundos sin bloquear el request con timers; si la instalación reportó background recientemente, no aplicar espera.
4. Confirmación autenticada y acotada a usuario/sesión/instalación: HTTP y evento Socket.IO. Aceptar únicamente la declaración `visibility=foreground` enviada después de presentar la tarjeta. No significa lectura ni aceptación.
5. Reserva atómica del despacho frente a confirmaciones concurrentes. Si la confirmación gana, no enviar. Si el despacho ya empezó, informar ese límite; no prometer retirar un push en tránsito. La confirmación impide reintentos posteriores aunque llegue durante un envío fallido.
6. Worker con intervalo predeterminado de 500 ms; valores explícitos anteriores deben actualizarse para reducir latencia. Revalidar sesión, versión de registro, vigencia e invitación antes del despacho.
7. Pruebas unitarias y PostgreSQL aislado: espera, presencia caducada, dos instalaciones, idempotencia, revocación, rotación, aislamiento, carreras ACK/despacho, reintentos y compatibilidad de mensajes existentes.
8. Actualizar guías y variables de entorno con contrato Flutter, despliegue/rollback y límites de latencia/entrega.

## Alcance

Implementar backend y documentación en este repositorio. Flutter no está disponible aquí: no se modifica ni se declara implementada su presentación/confirmación. Clientes sin el contrato nuevo conservan recepción FCM tras la espera. No desplegar ni ejecutar migraciones sobre tablas de producción.

## Resultado

Implementado en backend: migración incremental, presencia por instalación, confirmaciones HTTP/Socket.IO, identidad compartida, espera persistida, reserva atómica, limpieza y documentación. El contrato de Flutter está en `docs/push-socket-fallback.md` y la guía móvil existente enlaza la actualización.

Verificación: suite general con 229 pruebas correctas y cuatro suites opt-in omitidas; integración push con 24 escenarios correctos (26 pruebas contando los dos contenedores del runner), incluyendo socket real, carreras ACK/despacho y rollback. Firebase se simuló en las pruebas; no hubo envíos reales ni despliegue.

Pendiente externo: aplicar migración/configuración en el entorno autorizado y adaptar Flutter para reportar lifecycle y confirmar después de presentar. No se amplía la disponibilidad del conductor ni se implementa ubicación en segundo plano como parte de este cambio.
