const crypto = require("crypto");

const { env } = require("../../../config");
const AuthModel = require("../models/auth.model");
const RefreshTokenModel = require("../models/refresh-token.model");
const MobileSessionModel = require("../models/mobile-session.model");
const MobileSessions = require("./mobile-session.service");

function createHttpError(message, status = 401) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hashRefreshToken(refreshToken) {
  return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

function generateRefreshToken() {
  return crypto.randomBytes(env.security.refreshTokenBytes).toString("base64url");
}

function getRefreshTokenTtlSeconds(rememberMe = false) {
  return rememberMe
    ? env.security.refreshTokenRememberMeTtlSeconds
    : env.security.refreshTokenTtlSeconds;
}

function buildExpiresAt(rememberMe = false) {
  return new Date(Date.now() + getRefreshTokenTtlSeconds(rememberMe) * 1000);
}

function isExpired(tokenRow) {
  return new Date(tokenRow.expires_at).getTime() <= Date.now();
}

async function issueRefreshToken({ userId, rememberMe = false, metadata = {}, transaction = null, mobileSession = null }) {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = mobileSession ? new Date(mobileSession.expires_at) : buildExpiresAt(rememberMe);

  const row = await RefreshTokenModel.create({
    userId,
    tokenHash,
    expiresAt,
    ip: metadata.ip,
    userAgent: metadata.userAgent,
    sessionId: mobileSession?.id,
    familyId: mobileSession?.family_id,
  }, transaction);

  return {
    refreshToken,
    refreshTokenRow: row,
    refreshExpiresIn: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  };
}

async function rotateRefreshToken({ refreshToken, rememberMe = false, metadata = {}, deviceId }) {
  const tokenHash = hashRefreshToken(refreshToken);
  const currentToken = await RefreshTokenModel.findByHash(tokenHash);

  if (!currentToken) {
    throw createHttpError("Invalid refresh token.");
  }

  if (currentToken.revoked_at) {
    await RefreshTokenModel.revokeFamily(
      currentToken.family_id,
      "refresh_token_reuse_detected"
    );
    throw createHttpError("Invalid refresh token.");
  }

  if (isExpired(currentToken)) {
    await RefreshTokenModel.revokeByHash(tokenHash, "expired");
    throw createHttpError("Refresh token has expired.");
  }

  const userRow = await AuthModel.findById(currentToken.user_id);
  if (!userRow) {
    await RefreshTokenModel.revokeFamily(currentToken.family_id, "user_missing");
    throw createHttpError("User linked to token no longer exists.");
  }
  if (userRow.status !== "active") {
    await RefreshTokenModel.revokeFamily(currentToken.family_id, "user_inactive");
    throw createHttpError("User account is not active.", 403);
  }
  if (!currentToken.session_id && ["client", "driver"].includes(userRow.role) && userRow.phone_verified) {
    await RefreshTokenModel.revokeFamily(currentToken.family_id, "otp_session_required");
    throw MobileSessions.requireOtp();
  }
  let mobileSession = null;
  if (currentToken.session_id) {
    mobileSession = await MobileSessionModel.findActive(currentToken.session_id, currentToken.user_id);
    if (!mobileSession || mobileSession.family_id !== currentToken.family_id) {
      throw createHttpError("Mobile session is invalid or expired. Authenticate again with OTP.");
    }
    if (typeof deviceId !== "string" || deviceId.toLowerCase() !== mobileSession.installation_id) {
      throw createHttpError("Installation does not match this session. Authenticate again with OTP.");
    }
    rememberMe = mobileSession.remember_me;
  }

  const newRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRefreshToken);
  const { newToken, mobileSession: renewedSession } = await RefreshTokenModel.rotate({
    currentTokenHash: tokenHash,
    newTokenHash,
    expiresAt: mobileSession
      ? new Date(Math.min(buildExpiresAt(rememberMe).getTime(), new Date(mobileSession.absolute_expires_at).getTime()))
      : buildExpiresAt(rememberMe),
    ip: metadata.ip,
    userAgent: metadata.userAgent,
  });

  if (!newToken) {
    await RefreshTokenModel.revokeFamily(
      currentToken.family_id,
      "refresh_token_reuse_detected"
    );
    throw createHttpError("Invalid refresh token.");
  }

  return {
    userRow,
    refreshToken: newRefreshToken,
    refreshTokenRow: newToken,
    refreshExpiresIn: Math.max(0, Math.floor((new Date(newToken.expires_at).getTime() - Date.now()) / 1000)),
    mobileSession: renewedSession,
    rememberMe,
  };
}

async function revokeRefreshToken(refreshToken, reason = "logout") {
  if (!refreshToken) {
    return null;
  }

  return RefreshTokenModel.revokeByHash(hashRefreshToken(refreshToken), reason);
}

async function revokeAllForUser(userId, reason = "logout_all") {
  return RefreshTokenModel.revokeAllForUser(userId, reason);
}

module.exports = {
  generateRefreshToken,
  getRefreshTokenTtlSeconds,
  hashRefreshToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
