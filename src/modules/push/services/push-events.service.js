const Push = require("./push.service");
const { env } = require("../../../config");
const { logger } = require("../../../config/logger");
const { pool } = require("../../../config/database");
const { invitationEventId } = require("./invitation-identity");
const COPY = {
  driver_assigned: ["Conductor asignado", "Un conductor aceptó tu viaje."],
  driver_en_route: ["Conductor en camino", "Tu conductor va hacia el punto de recogida."],
  driver_arrived: ["Tu conductor llegó", "Consulta tu viaje para continuar."],
  in_progress: ["Viaje iniciado", "Tu viaje está en curso."],
  completed: ["Viaje finalizado", "Ya puedes consultar el resumen del viaje."],
  canceled_by_client: ["Viaje cancelado", "Consulta el estado actualizado del servicio."],
  canceled_by_driver: ["Viaje cancelado", "Consulta el estado actualizado del servicio."],
  canceled_by_system: ["Viaje cancelado", "Consulta el estado actualizado del servicio."],
};
async function rideStatus({ ride, event }) {
  if (!env.push.enabled || !ride?.id || !event?.id || !COPY[ride.status]) return;
  const recipients = ride.status.startsWith("canceled_") ? [ride.clientId, ride.driverId] : [ride.clientId];
  const occurredAt = new Date(event.occurredAt || event.occurred_at || Date.now()).getTime();
  return Push.sendToUsers(recipients.filter((id) => id && id !== (event.actorId || event.actor_id)), {
    eventId: `ride:${event.id}`, type: "ride.status", rideId: ride.id, status: ride.status,
    sourceEventId: event.id, title: COPY[ride.status][0], body: COPY[ride.status][1],
    expiresAt: new Date(occurredAt + (ride.status === "completed" ? 3600 : 300) * 1000),
  });
}
async function invitations({ ride, invites }) {
  if (!env.push.enabled) return;
  for (const invite of invites || []) {
    const eventId = invitationEventId(invite);
    if (!eventId || !invite.driverId) continue;
    const invitedAt = new Date(invite.invitedAt).toISOString();
    await Push.sendToUser(invite.driverId, { eventId, type: "ride.invite",
      rideId: ride.id, inviteId: invite.id, invitedAt,
      title: "Nueva solicitud de viaje", body: "Hay un servicio disponible. Abre la app para consultar la invitación.",
      // Transport freshness cap, not a change to the business invitation timeout.
      expiresAt: new Date(Date.parse(invitedAt) + env.push.inviteTtlSeconds * 1000) });
  }
}
async function panic(notification) {
  if (!env.push.enabled) return;
  const { rows } = await pool.query("SELECT id FROM users WHERE role IN ('admin','operator') AND status='active' AND deleted_at IS NULL");
  return Push.sendToUsers(rows.map((row) => row.id), { eventId: `panic:${notification.id}`, type: "driver.panic",
    notificationId: notification.id, title: "Alerta de pánico", body: "Un conductor necesita atención. Abre la cola de incidentes.",
    expiresAt: new Date(new Date(notification.createdAt || Date.now()).getTime() + 300000) });
}
// Call only after the business transaction commits. Failures cannot reject a ride operation.
async function safely(action) {
  try { await action(); }
  catch { logger.warn("push_event_enqueue_failed"); }
}
module.exports = { rideStatus, invitations, panic, safely };
