const AuthModel = require("../../auth/models/auth.model");
const Model = require("../models/user.model");
const { normalizePatch } = require("../middleware/user.middleware");
const { TERMINAL_RIDE_STATUSES } = require("../../rides/constants/ride-status");
const columns = { licenseNumber: "license_number", vehicleMake: "vehicle_make", vehicleModel: "vehicle_model", vehicleYear: "vehicle_year", vehicleColor: "vehicle_color", vehiclePlate: "vehicle_plate", vehicleType: "vehicle_type" };
function error(status, message) { return Object.assign(new Error(message), { status }); }
async function getUser(actor, id) {
  if (!["admin", "operator"].includes(actor.role) && actor.id !== id) throw error(403, "Forbidden.");
  const row = await AuthModel.findById(id);
  if (!row || (actor.role === "operator" && row.role !== "client")) throw error(404, "User not found.");
  return { user: AuthModel.toPublicUser(row) };
}
async function updateUser(actor, id, body) {
  try {
    const result = await Model.transaction(async (db) => {
      const locked = await db.query("SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
      const user = locked.rows[0];
      if (!user) throw error(404, "User not found.");
      if (actor.id !== id && actor.role !== "admin") throw error(403, "Forbidden.");
      const patch = normalizePatch(body, user.role);
      const common = {};
      for (const [key, column] of [["firstName", "first_name"], ["lastName", "last_name"]]) if (Object.hasOwn(patch, key)) common[column] = patch[key];
      await Model.updateFields(db, "users", id, common);
      let approvalRequired = false;
      if (patch.clientProfile) {
        await db.query("INSERT INTO clients (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [id]);
        const p = patch.clientProfile;
        if (Object.hasOwn(p, "defaultPaymentMethod")) await Model.updateFields(db, "clients", id, { default_payment_method: p.defaultPaymentMethod });
        if (Object.hasOwn(p, "homeLocation")) await db.query("UPDATE clients SET home_location = ST_GeogFromText($2), updated_at = clock_timestamp() WHERE user_id = $1", [id, p.homeLocation ? `SRID=4326;POINT(${p.homeLocation.lng} ${p.homeLocation.lat})` : null]);
      }
      if (patch.driverProfile) {
        const lockedDriver = await db.query("SELECT * FROM drivers WHERE user_id = $1 FOR UPDATE", [id]);
        const driver = lockedDriver.rows[0];
        if (!driver) throw error(404, "Driver profile not found.");
        const fields = {};
        for (const [key, value] of Object.entries(patch.driverProfile)) if (key !== "documents" && driver[columns[key]] !== value) fields[columns[key]] = value;
        if (patch.driverProfile.documents) {
          const documents = { ...(driver.documents || {}) };
          for (const [key, value] of Object.entries(patch.driverProfile.documents)) {
            if (value === null) delete documents[key]; else documents[key] = value;
          }
          if (JSON.stringify(documents) !== JSON.stringify(driver.documents || {})) fields.documents = JSON.stringify(documents);
        }
        approvalRequired = ["license_number", "vehicle_plate", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_type", "documents"].some((key) => Object.hasOwn(fields, key));
        if (approvalRequired) {
          const rides = await db.query("SELECT id FROM rides WHERE driver_id = $1 AND status <> ALL($2::text[]) LIMIT 1", [id, [...TERMINAL_RIDE_STATUSES]]);
          if (rides.rows.length) throw error(409, "Finish the active ride before modifying vehicle or license data.");
          Object.assign(fields, { approval_status: "pending", approval_notes: null, reviewed_by_admin_id: null, reviewed_at: null, status: "offline", availability_intent: "offline", offline_reason: "profile_review" });
        }
        await Model.updateFields(db, "drivers", id, fields);
      }
      const fields = Object.entries(patch).flatMap(([key, value]) => key.endsWith("Profile") ? Object.keys(value).map((child) => `${key}.${child}`) : [key]);
      await Model.audit(db, actor.id, id, "profile_updated", fields);
      return { user: AuthModel.toPublicUser(await AuthModel.findById(id, db)), approvalRequired };
    });
    if (result.approvalRequired) {
      require("../../drivers/services/driver-presence-cache.service").removeRecentPresenceBestEffort(id);
      try {
        const { emitToUser, emitToRole } = require("../../../realtime/socket.server");
        emitToUser(id, "user:profile-updated", result);
        emitToRole("admin", "user:profile-updated", result);
      } catch { require("../../../config/logger").logger.warn("profile_update_notification_failed", { userId: id }); }
    }
    return result;
  } catch (err) {
    if (err.code === "23505") throw error(409, "A unique profile value is already in use.");
    throw err;
  }
}
async function updateStatus(actor, id, body) {
  const { keys } = require("../middleware/user.middleware");
  keys(body, ["status"]);
  if (actor.role !== "admin") throw error(403, "Forbidden.");
  if (!["active", "inactive", "suspended"].includes(body.status)) throw error(400, "Invalid account status.");
  if (id === actor.id) throw error(409, "Cannot change your own administrative status.");
  const sessions = await Model.transaction(async (db) => {
    const locked = await db.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", [id]);
    if (!locked.rows.length) throw error(404, "User not found.");
    await Model.updateFields(db, "users", id, { status: body.status });
    const sessions = await require("../../auth/services/identity-change.service").revoke(db, id, "account_status_changed");
    if (body.status !== "active") await db.query("UPDATE drivers SET status = 'offline', availability_intent = 'offline', offline_reason = 'account_status_changed' WHERE user_id = $1", [id]);
    await Model.audit(db, actor.id, id, "account_status_changed", ["status"]);
    return sessions;
  });
  require("../../auth/services/mobile-session-events").notifyRevoked(sessions);
  return getUser(actor, id);
}
module.exports = { getUser, updateUser, updateStatus };
