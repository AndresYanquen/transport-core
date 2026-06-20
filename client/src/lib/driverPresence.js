export const DRIVER_STALE_MS = 90_000;

export function isDriverStale(driver, now = Date.now()) {
  if (!driver?.lastSeenAt) return true;
  const lastSeen = new Date(driver.lastSeenAt).getTime();
  return !Number.isFinite(lastSeen) || now - lastSeen > DRIVER_STALE_MS;
}

export function driverPresenceKey(driver) {
  if (driver?.status === "online") return "available";
  if (driver?.status === "busy") return isDriverStale(driver) ? "busy_unreachable" : "busy";
  if (driver?.status === "unavailable") return "unavailable";
  if (driver?.offlineReason === "heartbeat_timeout") return "connection_lost";
  return "driver_offline";
}

export function driverPresenceLabel(driver) {
  return {
    available: "Disponible",
    busy: "En servicio",
    busy_unreachable: "En servicio · Sin conexión",
    unavailable: "No acepta servicios",
    connection_lost: "Conexión perdida",
    driver_offline: "Conductor desconectado",
  }[driverPresenceKey(driver)];
}

export function driverPresenceClass(driver) {
  return {
    available: "border-emerald-200 bg-emerald-50 text-emerald-700",
    busy: "border-amber-200 bg-amber-50 text-amber-700",
    busy_unreachable: "border-rose-200 bg-rose-50 text-rose-700",
    unavailable: "border-slate-200 bg-slate-100 text-slate-700",
    connection_lost: "border-rose-200 bg-rose-50 text-rose-700",
    driver_offline: "border-slate-200 bg-slate-100 text-slate-600",
  }[driverPresenceKey(driver)];
}

export function offlineReasonLabel(reason) {
  return {
    driver_request: "Desconexión solicitada por el conductor",
    heartbeat_timeout: "Tiempo de espera de presencia agotado",
  }[reason] || reason || "-";
}
