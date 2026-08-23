const test = require("node:test");
const assert = require("node:assert/strict");
const { TokenVerifier } = require("livekit-server-sdk");

const RadioService = require("../src/modules/radio/services/radio.service");
const DriverModel = require("../src/modules/drivers/models/driver.model");
const { env } = require("../src/config");
const RedisConfig = require("../src/config/redis");

function createRedisMock() {
  const store = new Map();

  return {
    store,
    async sendCommand(command) {
      const [op, ...args] = command;
      if (op === "SET") {
        const [key, value] = args;
        const nx = args.includes("NX");
        if (nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }
      if (op === "GET") {
        return store.get(args[0]) || null;
      }
      if (op === "DEL") {
        const existed = store.delete(args[0]);
        return existed ? 1 : 0;
      }
      if (op === "EVAL") {
        const key = args[2];
        const userId = args[3];
        const current = store.get(key);
        if (!current) return 0;
        const decoded = JSON.parse(current);
        if (decoded.userId !== userId) return -1;
        if (/EXPIRE/.test(args[0])) return 1;
        store.delete(key);
        return 1;
      }
      throw new Error(`Unsupported Redis command ${op}`);
    },
  };
}

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

test("radio talk lock grants first speaker and denies concurrent speaker", async () => {
  const RadioModel = require("../src/modules/radio/models/radio.model");
  const redis = createRedisMock();
  const originals = {
    getRedisCommandClient: RedisConfig.getRedisCommandClient,
    getSession: RadioModel.getSession,
    updateSession: RadioModel.updateSession,
    insertEvent: RadioModel.insertEvent,
  };
  const events = [];
  RedisConfig.getRedisCommandClient = async () => redis;
  RadioModel.getSession = async () => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: "idle",
  });
  RadioModel.updateSession = async (_id, fields) => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: fields.status,
    speaker: fields.speaker,
  });
  RadioModel.insertEvent = async (event) => events.push(event);

  try {
    const granted = await RadioService.acquireTalkLock("session-1", {
      id: "operator-1",
      role: "operator",
    });
    const denied = await RadioService.acquireTalkLock("session-1", {
      id: "driver-1",
      role: "driver",
    });

    assert.equal(granted.granted, true);
    assert.equal(granted.session.status, "operator_speaking");
    assert.equal(granted.talk.userId, "operator-1");
    assert.equal(denied.granted, false);
    assert.equal(denied.reason, "busy");
    assert.equal(denied.talk.userId, "operator-1");
    assert.equal(events[0].eventType, "talk_started");
  } finally {
    Object.assign(RedisConfig, { getRedisCommandClient: originals.getRedisCommandClient });
    RadioModel.getSession = originals.getSession;
    RadioModel.updateSession = originals.updateSession;
    RadioModel.insertEvent = originals.insertEvent;
  }
});

test("radio talk lock release requires lock owner", async () => {
  const RadioModel = require("../src/modules/radio/models/radio.model");
  const redis = createRedisMock();
  const originals = {
    getRedisCommandClient: RedisConfig.getRedisCommandClient,
    getSession: RadioModel.getSession,
    updateSession: RadioModel.updateSession,
    insertEvent: RadioModel.insertEvent,
  };
  RedisConfig.getRedisCommandClient = async () => redis;
  RadioModel.getSession = async () => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: "operator_speaking",
  });
  RadioModel.updateSession = async (_id, fields) => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: fields.status,
    speaker: fields.speaker,
  });
  RadioModel.insertEvent = async () => {};

  try {
    await RadioService.acquireTalkLock("session-1", {
      id: "operator-1",
      role: "operator",
    });
    const denied = await RadioService.releaseTalkLock("session-1", {
      id: "driver-1",
      role: "driver",
    });
    const released = await RadioService.releaseTalkLock("session-1", {
      id: "operator-1",
      role: "operator",
    });

    assert.equal(denied.released, false);
    assert.equal(denied.reason, "not_owner");
    assert.equal(released.released, true);
    assert.equal(released.session.status, "idle");
  } finally {
    Object.assign(RedisConfig, { getRedisCommandClient: originals.getRedisCommandClient });
    RadioModel.getSession = originals.getSession;
    RadioModel.updateSession = originals.updateSession;
    RadioModel.insertEvent = originals.insertEvent;
  }
});

test("livekit session token is limited to the radio session room", async () => {
  const RadioModel = require("../src/modules/radio/models/radio.model");
  const originalGetSession = RadioModel.getSession;
  const originalConfig = { ...env.livekit };
  RadioModel.getSession = async () => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: "idle",
  });
  Object.assign(env.livekit, {
    url: "wss://livekit.gottaxi.co",
    apiKey: "test-key",
    apiSecret: "test-secret",
    tokenTtl: "10m",
  });

  try {
    const result = await RadioService.createLiveKitTokenForSession("session-1", {
      id: "driver-1",
      role: "driver",
      firstName: "Driver",
    });
    const decoded = await new TokenVerifier("test-key", "test-secret").verify(result.livekit.token);

    assert.equal(result.livekit.url, "wss://livekit.gottaxi.co");
    assert.equal(result.livekit.room, "radio-session-1");
    assert.equal(result.livekit.identity, "driver-driver-1");
    assert.equal(decoded.sub, "driver-driver-1");
    assert.equal(decoded.video.room, "radio-session-1");
    assert.equal(decoded.video.roomJoin, true);
    assert.equal(decoded.video.canPublish, true);
    assert.equal(decoded.video.canSubscribe, true);
  } finally {
    RadioModel.getSession = originalGetSession;
    Object.assign(env.livekit, originalConfig);
  }
});

test("livekit token requires configuration and active session", async () => {
  const RadioModel = require("../src/modules/radio/models/radio.model");
  const originalGetSession = RadioModel.getSession;
  const originalConfig = { ...env.livekit };
  RadioModel.getSession = async () => ({
    id: "session-1",
    operatorId: "operator-1",
    driverId: "driver-1",
    status: "ended",
  });
  Object.assign(env.livekit, {
    url: "",
    apiKey: "",
    apiSecret: "",
    tokenTtl: "10m",
  });

  try {
    await assert.rejects(
      () => RadioService.createLiveKitTestToken({ id: "operator-1", role: "operator" }),
      (error) => error.status === 503 && /not configured/.test(error.message)
    );
    await assert.rejects(
      () => RadioService.createLiveKitTokenForSession("session-1", {
        id: "driver-1",
        role: "driver",
      }),
      (error) => error.status === 409 && /Session ended/.test(error.message)
    );
  } finally {
    RadioModel.getSession = originalGetSession;
    Object.assign(env.livekit, originalConfig);
  }
});

test("livekit test token accepts driver and client roles", async () => {
  const originalConfig = { ...env.livekit };
  Object.assign(env.livekit, {
    url: "wss://livekit.gottaxi.co",
    apiKey: "test-key",
    apiSecret: "test-secret",
    tokenTtl: "10m",
    testRoom: "radio-test",
  });

  try {
    const driverResult = await RadioService.createLiveKitTestToken({
      id: "driver-1",
      role: "driver",
    });
    const clientResult = await RadioService.createLiveKitTestToken({
      id: "client-1",
      role: "client",
    });

    assert.equal(driverResult.livekit.room, "radio-test");
    assert.equal(driverResult.livekit.identity, "driver-driver-1");
    assert.equal(clientResult.livekit.room, "radio-test");
    assert.equal(clientResult.livekit.identity, "client-client-1");
  } finally {
    Object.assign(env.livekit, originalConfig);
  }
});
