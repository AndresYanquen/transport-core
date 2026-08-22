const DriverNotificationModel = require("../models/driver-notification.model");
const DriverModel = require("../../drivers/models/driver.model");
const { emitToRole } = require("../../../realtime/socket.server");

const PANIC_COOLDOWN_SECONDS = 300;
const ACTIVE_STATUSES = new Set(["unread", "acknowledged"]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function emitNotification(notification, event = "operations:driver-notification-updated") {
  const payload = {
    notification,
    emittedAt: new Date().toISOString(),
  };

  emitToRole("operator", event, payload);
  emitToRole("admin", event, payload);
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata;
}

async function createPanicAlert(driverId, payload = {}) {
  const driver = await DriverModel.getDriverById(driverId);
  if (!driver) {
    throw httpError(404, "Driver not found.");
  }

  const existing = await DriverNotificationModel.findActivePanicByDriver(driverId, {
    withinSeconds: PANIC_COOLDOWN_SECONDS,
  });

  if (existing) {
    return { notification: existing, idempotent: true };
  }

  const metadata = normalizeMetadata(payload.metadata);
  const notification = await DriverNotificationModel.create({
    driverId,
    rideId: payload.rideId || null,
    type: "panic",
    priority: "emergency",
    status: "unread",
    title: payload.title || "Alerta de pánico",
    message: payload.message || "El conductor activó el botón de pánico.",
    metadata,
  });

  emitNotification(notification, "operations:driver-panic-created");

  return { notification, idempotent: false };
}

async function listNotifications(query = {}) {
  const status = query.status || "unread";
  const type = query.type || null;
  return { notifications: await DriverNotificationModel.list({ status, type, limit: query.limit }) };
}

async function acknowledgeNotification(notificationId, userId) {
  const client = await DriverNotificationModel.pool.connect();
  try {
    await client.query("BEGIN");
    const notification = await DriverNotificationModel.getById(notificationId, {
      forUpdate: true,
      client,
    });

    if (!notification) {
      throw httpError(404, "Driver notification not found.");
    }

    if (notification.status === "resolved" || notification.status === "dismissed") {
      throw httpError(409, "Driver notification is already closed.");
    }

    const updated = await DriverNotificationModel.update(
      notificationId,
      {
        status: "acknowledged",
        acknowledged_by_user_id: userId,
        acknowledged_at: new Date(),
      },
      client
    );
    await client.query("COMMIT");
    emitNotification(updated, "operations:driver-notification-acknowledged");
    return { notification: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resolveNotification(notificationId, userId) {
  const client = await DriverNotificationModel.pool.connect();
  try {
    await client.query("BEGIN");
    const notification = await DriverNotificationModel.getById(notificationId, {
      forUpdate: true,
      client,
    });

    if (!notification) {
      throw httpError(404, "Driver notification not found.");
    }

    if (!ACTIVE_STATUSES.has(notification.status)) {
      throw httpError(409, "Driver notification is already closed.");
    }

    const fields = {
      status: "resolved",
      resolved_by_user_id: userId,
      resolved_at: new Date(),
    };

    if (!notification.acknowledgedAt) {
      fields.acknowledged_by_user_id = userId;
      fields.acknowledged_at = new Date();
    }

    const updated = await DriverNotificationModel.update(notificationId, fields, client);
    await client.query("COMMIT");
    emitNotification(updated, "operations:driver-notification-resolved");
    return { notification: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createPanicAlert,
  listNotifications,
  acknowledgeNotification,
  resolveNotification,
  __private: { PANIC_COOLDOWN_SECONDS, normalizeMetadata },
};
