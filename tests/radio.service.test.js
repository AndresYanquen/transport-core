const test = require("node:test");
const assert = require("node:assert/strict");

const RadioService = require("../src/modules/radio/services/radio.service");
const DriverModel = require("../src/modules/drivers/models/driver.model");

test("radio request creation requires a reachable driver", async () => {
  const original = DriverModel.getDriverById;
  DriverModel.getDriverById = async () => ({
    userId: "driver-1",
    status: "offline",
    lastSeenAt: new Date().toISOString(),
  });
  try {
    await assert.rejects(
      () => RadioService.createDriverRequest("driver-1", {}),
      (error) => error.status === 409 && /offline or unreachable/.test(error.message)
    );
  } finally {
    DriverModel.getDriverById = original;
  }
});

test("session access is limited to participants and admins", async () => {
  const RadioModel = require("../src/modules/radio/models/radio.model");
  const original = RadioModel.getSession;
  RadioModel.getSession = async () => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: "idle",
  });
  try {
    await assert.rejects(
      () => RadioService.getSessionForParticipant("session-1", {
        id: "driver-2",
        role: "driver",
      }),
      (error) => error.status === 403
    );
    const session = await RadioService.getSessionForParticipant("session-1", {
      id: "admin-1",
      role: "admin",
    });
    assert.equal(session.id, "session-1");
  } finally {
    RadioModel.getSession = original;
  }
});
