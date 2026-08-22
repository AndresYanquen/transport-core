const test = require("node:test");
const assert = require("node:assert/strict");

const DriverNotificationService = require("../src/modules/driver-notifications/services/driver-notification.service");
const DriverNotificationModel = require("../src/modules/driver-notifications/models/driver-notification.model");
const DriverModel = require("../src/modules/drivers/models/driver.model");

test("panic alert creation reuses a recent active panic alert", async () => {
  const originalGetDriverById = DriverModel.getDriverById;
  const originalFindActivePanicByDriver = DriverNotificationModel.findActivePanicByDriver;
  const originalCreate = DriverNotificationModel.create;
  let createCalls = 0;

  DriverModel.getDriverById = async () => ({ userId: "driver-1" });
  DriverNotificationModel.findActivePanicByDriver = async () => ({
    id: "notification-1",
    driverId: "driver-1",
    type: "panic",
    status: "unread",
  });
  DriverNotificationModel.create = async () => {
    createCalls += 1;
    return { id: "notification-2" };
  };

  try {
    const result = await DriverNotificationService.createPanicAlert("driver-1", {});
    assert.equal(result.idempotent, true);
    assert.equal(result.notification.id, "notification-1");
    assert.equal(createCalls, 0);
  } finally {
    DriverModel.getDriverById = originalGetDriverById;
    DriverNotificationModel.findActivePanicByDriver = originalFindActivePanicByDriver;
    DriverNotificationModel.create = originalCreate;
  }
});

test("panic alert creation persists an emergency notification", async () => {
  const originalGetDriverById = DriverModel.getDriverById;
  const originalFindActivePanicByDriver = DriverNotificationModel.findActivePanicByDriver;
  const originalCreate = DriverNotificationModel.create;
  let createdPayload = null;

  DriverModel.getDriverById = async () => ({ userId: "driver-1" });
  DriverNotificationModel.findActivePanicByDriver = async () => null;
  DriverNotificationModel.create = async (payload) => {
    createdPayload = payload;
    return { id: "notification-1", ...payload };
  };

  try {
    const result = await DriverNotificationService.createPanicAlert("driver-1", {
      rideId: "ride-1",
      metadata: { location: { lat: 5.54, lng: -73.36 } },
    });

    assert.equal(result.idempotent, false);
    assert.equal(createdPayload.driverId, "driver-1");
    assert.equal(createdPayload.rideId, "ride-1");
    assert.equal(createdPayload.type, "panic");
    assert.equal(createdPayload.priority, "emergency");
    assert.equal(createdPayload.status, "unread");
    assert.deepEqual(createdPayload.metadata, { location: { lat: 5.54, lng: -73.36 } });
  } finally {
    DriverModel.getDriverById = originalGetDriverById;
    DriverNotificationModel.findActivePanicByDriver = originalFindActivePanicByDriver;
    DriverNotificationModel.create = originalCreate;
  }
});

test("resolving an unread notification also acknowledges it", async () => {
  const originalPool = DriverNotificationModel.pool.connect;
  const originalGetById = DriverNotificationModel.getById;
  const originalUpdate = DriverNotificationModel.update;
  const queries = [];
  let updateFields = null;

  DriverNotificationModel.pool.connect = async () => ({
    query: async (sql) => {
      queries.push(sql);
    },
    release: () => {},
  });
  DriverNotificationModel.getById = async () => ({
    id: "notification-1",
    status: "unread",
    acknowledgedAt: null,
  });
  DriverNotificationModel.update = async (_id, fields) => {
    updateFields = fields;
    return { id: "notification-1", ...fields };
  };

  try {
    const result = await DriverNotificationService.resolveNotification("notification-1", "operator-1");
    assert.equal(result.notification.status, "resolved");
    assert.equal(updateFields.resolved_by_user_id, "operator-1");
    assert.equal(updateFields.acknowledged_by_user_id, "operator-1");
    assert.ok(updateFields.acknowledged_at instanceof Date);
    assert.ok(updateFields.resolved_at instanceof Date);
    assert.deepEqual(queries, ["BEGIN", "COMMIT"]);
  } finally {
    DriverNotificationModel.pool.connect = originalPool;
    DriverNotificationModel.getById = originalGetById;
    DriverNotificationModel.update = originalUpdate;
  }
});
