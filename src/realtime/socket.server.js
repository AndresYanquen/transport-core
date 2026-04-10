const { Server } = require("socket.io");

const { env } = require("../config");
const AuthModel = require("../modules/auth/models/auth.model");
const { verifyJwt } = require("../modules/auth/utils/jwt");

let ioInstance = null;

function isLocalhostOrigin(origin) {
  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch (_error) {
    return false;
  }
}

function isAllowedOrigin(origin) {
  const allowedOrigins = env.cors.allowedOrigins || [];
  const allowAllOrigins = allowedOrigins.includes("*");
  const allowLocalhostTemporarily = Boolean(env.cors.allowLocalhostTemporarily);

  return (
    !origin ||
    allowAllOrigins ||
    allowedOrigins.includes(origin) ||
    (allowLocalhostTemporarily && isLocalhostOrigin(origin))
  );
}

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

  const queryToken =
    typeof socket.handshake.query?.token === "string" ? socket.handshake.query.token : null;
  return queryToken;
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

async function socketAuthMiddleware(socket, next) {
  try {
    const token = extractSocketToken(socket);

    if (!token) {
      return next(new Error("Authorization token required for socket connection."));
    }

    const payload = verifyJwt(token, {
      secret: env.security.jwtSecret,
    });

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
    const { user } = socket.data;
    socket.join(userRoom(user.id));
    socket.join(roleRoom(user.role));

    socket.emit("realtime:ready", {
      socketId: socket.id,
      userId: user.id,
      role: user.role,
      connectedAt: new Date().toISOString(),
    });

    socket.on("ride:subscribe", ({ rideId } = {}) => {
      if (!rideId) {
        return;
      }
      socket.join(rideRoom(rideId));
    });

    socket.on("ride:unsubscribe", ({ rideId } = {}) => {
      if (!rideId) {
        return;
      }
      socket.leave(rideRoom(rideId));
    });
  });
}

function initializeSocketServer(httpServer) {
  if (!env.realtime.enabled) {
    return null;
  }

  const io = new Server(httpServer, {
    path: env.realtime.path,
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);
  registerConnectionHandlers(io);
  ioInstance = io;

  return io;
}

function getSocketServer() {
  return ioInstance;
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

module.exports = {
  initializeSocketServer,
  getSocketServer,
  emitToRide,
  emitToUser,
  userRoom,
  roleRoom,
  rideRoom,
};
