const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

const { env } = require("../config");
const { isAllowedCorsOrigin } = require("../config/cors");
const { initializeRedisClients } = require("../config/redis");
const { logger } = require("../config/logger");
const AuthModel = require("../modules/auth/models/auth.model");
const { verifyJwt } = require("../modules/auth/utils/jwt");
const { query } = require("../config/database");

let ioInstance = null;
const PUBLIC_TRACKING_SCOPE = "ride_tracking";
const uuidV4LikeRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function extractBearerToken(headerValue = "") {
  const matches = headerValue.match(/^Bearer\s+(.+)$/i);
  return matches ? matches[1] : null;
}

function extractSocketToken(socket) {
  const authToken =
    typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : null;
  if (authToken) {
    return authToken;
  }

  const authorization = socket.handshake.headers?.authorization;
  const bearer = extractBearerToken(authorization);
  if (bearer) {
    return bearer;
  }

  return null;
}

function userRoom(userId) {
  return `user:${userId}`;
}

function roleRoom(role) {
  return `role:${role}`;
}

function rideRoom(rideId) {
  return `ride:${rideId}`;
}

async function ensureTrackingTokenCanAccessRideRoom({ rideId, trackingToken }) {
  if (!uuidV4LikeRegex.test(String(rideId || ""))) {
    return { ok: false, reason: "invalid_ride_id" };
  }

  if (!trackingToken) {
    return { ok: false, reason: "unauthorized" };
  }

  const { rows } = await query(
    `
      SELECT id
      FROM rides
      WHERE id = $1
        AND tracking_token = $2
      LIMIT 1
    `,
    [rideId, trackingToken]
  );

  return rows[0] ? { ok: true } : { ok: false, reason: "forbidden" };
}

async function ensureUserCanAccessRideRoom({ rideId, userId, role }) {
  if (!uuidV4LikeRegex.test(String(rideId || ""))) {
    return { ok: false, reason: "invalid_ride_id" };
  }

  if (!userId) {
    return { ok: false, reason: "unauthorized" };
  }

  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole === "admin") {
    return { ok: true };
  }

  const { rows } = await query(
    `
      SELECT client_id, driver_id
      FROM rides
      WHERE id = $1
      LIMIT 1
    `,
    [rideId]
  );

  if (!rows[0]) {
    return { ok: false, reason: "ride_not_found" };
  }

  if (normalizedRole === "client" && rows[0].client_id === userId) {
    return { ok: true };
  }

  if (normalizedRole === "driver" && rows[0].driver_id === userId) {
    return { ok: true };
  }

  return { ok: false, reason: "forbidden" };
}

async function socketAuthMiddleware(socket, next) {
  try {
    const token = extractSocketToken(socket);

    if (!token) {
      return next(new Error("Authorization token required for socket connection."));
    }

    const payload = verifyJwt(token, {
      secret: env.security.jwtSecret,
    });

    if (payload.scope === PUBLIC_TRACKING_SCOPE) {
      if (!payload.rideId || !payload.trackingToken) {
        return next(new Error("Tracking token missing ride access claims."));
      }

      const access = await ensureTrackingTokenCanAccessRideRoom({
        rideId: payload.rideId,
        trackingToken: payload.trackingToken,
      });

      if (!access.ok) {
        return next(new Error("Tracking token cannot access this ride."));
      }

      socket.data.auth = {
        token,
        scope: PUBLIC_TRACKING_SCOPE,
        rideId: payload.rideId,
        trackingToken: payload.trackingToken,
        payload,
      };

      return next();
    }

    if (!payload.sub) {
      return next(new Error("Authorization token missing subject."));
    }

    const userRow = await AuthModel.findById(payload.sub);

    if (!userRow) {
      return next(new Error("User linked to token no longer exists."));
    }

    const user = AuthModel.toPublicUser(userRow);

    socket.data.user = user;
    socket.data.auth = {
      token,
      userId: user.id,
      role: user.role,
      payload,
    };

    return next();
  } catch (error) {
    return next(new Error(error.message || "Unauthorized"));
  }
}

function registerConnectionHandlers(io) {
  io.on("connection", (socket) => {
    if (socket.data.auth?.scope === PUBLIC_TRACKING_SCOPE) {
      const { rideId } = socket.data.auth;

      socket.emit("realtime:ready", {
        socketId: socket.id,
        scope: PUBLIC_TRACKING_SCOPE,
        rideId,
        connectedAt: new Date().toISOString(),
      });

      socket.on("ride:public-subscribe", ({ rideId: requestedRideId } = {}) => {
        if (requestedRideId && requestedRideId !== rideId) {
          socket.emit("ride:subscribe-denied", {
            rideId: requestedRideId,
            reason: "forbidden",
          });
          return;
        }

        socket.join(rideRoom(rideId));
        socket.emit("ride:subscribed", { rideId });
      });

      socket.on("ride:unsubscribe", ({ rideId: requestedRideId } = {}) => {
        if (!requestedRideId || requestedRideId === rideId) {
          socket.leave(rideRoom(rideId));
        }
      });

      return;
    }

    const { user } = socket.data;
    socket.join(userRoom(user.id));
    socket.join(roleRoom(user.role));

    socket.emit("realtime:ready", {
      socketId: socket.id,
      userId: user.id,
      role: user.role,
      connectedAt: new Date().toISOString(),
    });

    const { registerRadioSocketHandlers } = require("../modules/radio/realtime/radio.socket");
    registerRadioSocketHandlers(io, socket, { userRoom });

    socket.on("ride:subscribe", async ({ rideId } = {}) => {
      if (!rideId) {
        return;
      }

      try {
        const access = await ensureUserCanAccessRideRoom({
          rideId,
          userId: user.id,
          role: user.role,
        });

        if (!access.ok) {
          socket.emit("ride:subscribe-denied", {
            rideId,
            reason: access.reason,
          });
          return;
        }

        socket.join(rideRoom(rideId));
        socket.emit("ride:subscribed", { rideId });
      } catch (error) {
        socket.emit("ride:subscribe-denied", {
          rideId,
          reason: "server_error",
        });
      }
    });

    socket.on("ride:unsubscribe", ({ rideId } = {}) => {
      if (!rideId) {
        return;
      }
      socket.leave(rideRoom(rideId));
    });
  });
}

async function initializeSocketServer(httpServer) {
  if (!env.realtime.enabled) {
    return null;
  }

  const io = new Server(httpServer, {
    path: env.realtime.path,
    cors: {
      origin: (origin, callback) => callback(null, isAllowedCorsOrigin(origin)),
      credentials: true,
    },
  });

  const redisClients = await initializeRedisClients();
  if (redisClients) {
    io.adapter(createAdapter(redisClients.pubClient, redisClients.subClient));
    logger.info("socket_redis_adapter_enabled");
  } else {
    logger.info("socket_memory_adapter_enabled");
  }

  io.use(socketAuthMiddleware);
  registerConnectionHandlers(io);
  ioInstance = io;

  return io;
}

function getSocketServer() {
  return ioInstance;
}

function closeSocketServer() {
  return new Promise((resolve, reject) => {
    if (!ioInstance) {
      resolve();
      return;
    }

    ioInstance.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      ioInstance = null;
      resolve();
    });
  });
}

function emitToRide(rideId, eventName, payload) {
  if (!ioInstance || !rideId || !eventName) {
    return;
  }

  ioInstance.to(rideRoom(rideId)).emit(eventName, payload);
}

function emitToUser(userId, eventName, payload) {
  if (!ioInstance || !userId || !eventName) {
    return;
  }

  ioInstance.to(userRoom(userId)).emit(eventName, payload);
}

function emitToRole(role, eventName, payload) {
  if (!ioInstance || !role || !eventName) {
    return;
  }

  ioInstance.to(roleRoom(role)).emit(eventName, payload);
}

function removeUserFromRideRoom(userId, rideId) {
  if (!ioInstance || !userId || !rideId) {
    return;
  }

  ioInstance.in(userRoom(userId)).socketsLeave(rideRoom(rideId));
}

module.exports = {
  initializeSocketServer,
  getSocketServer,
  closeSocketServer,
  emitToRide,
  emitToUser,
  emitToRole,
  removeUserFromRideRoom,
  userRoom,
  roleRoom,
  rideRoom,
};
