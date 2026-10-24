const AuthModel = require("../models/auth.model");
const { verifyJwt } = require("../utils/jwt");
const { env } = require("../../../config");
const MobileSessions = require("../services/mobile-session.service");

function extractBearerToken(headerValue = "") {
  const matches = headerValue.match(/^Bearer\s+(.+)$/i);
  return matches ? matches[1] : null;
}

async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res
        .status(401)
        .json({ message: "Authorization header with Bearer token required." });
    }

    const payload = verifyJwt(token, {
      secret: env.security.jwtSecret,
    });

    if (!payload.sub || payload.type !== "access") {
      return res.status(401).json({ message: "Authorization token missing subject." });
    }

    const userRow = await AuthModel.findById(payload.sub);

    if (!userRow) {
      return res.status(401).json({ message: "User linked to token no longer exists." });
    }
    if (userRow.status !== "active") return res.status(403).json({ message: "User account is not active." });
    if (payload.sid) await MobileSessions.assertActive(payload.sid, userRow.id);
    else MobileSessions.assertAdditionalFactorPolicy(userRow);
    MobileSessions.assertAccessContext(userRow, payload, `${req.baseUrl || ""}${req.path || ""}`);

    const user = AuthModel.toPublicUser(userRow);

    req.user = user;
    req.auth = {
      token,
      userId: user.id,
      role: user.role,
      payload,
    };

    next();
  } catch (error) {
    const status = error.status && Number.isInteger(error.status) ? error.status : 401;
    res.status(status).json({ message: error.message || "Unauthorized",
      ...(["OTP_REQUIRED", "ADDITIONAL_FACTOR_REQUIRED"].includes(error.code) ? { code: error.code } : {}) });
  }
}

function authorizeRoles(...allowedRoles) {
  const normalizedRoles = allowedRoles.map((role) => role.toLowerCase());

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = req.user.role.toLowerCase();

    if (!normalizedRoles.length || normalizedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ message: "Forbidden: insufficient permissions." });
  };
}

module.exports = {
  authenticate,
  authorizeRoles,
};
