const crypto = require("crypto");

const { env } = require("../../../config");
const AuthModel = require("../models/auth.model");
const RefreshTokenModel = require("../models/refresh-token.model");

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

async function issueRefreshToken({ userId, rememberMe = false, metadata = {} }) {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = buildExpiresAt(rememberMe);

  const row = await RefreshTokenModel.create({
    userId,
    tokenHash,
    expiresAt,
    ip: metadata.ip,
    userAgent: metadata.userAgent,
  });

  return {
    refreshToken,
    refreshTokenRow: row,
    refreshExpiresIn: getRefreshTokenTtlSeconds(rememberMe),
  };
}

async function rotateRefreshToken({ refreshToken, rememberMe = false, metadata = {} }) {
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

  const newRefreshToken = generateRefreshToken();
  const newTokenHash = hashRefreshToken(newRefreshToken);
  const { newToken } = await RefreshTokenModel.rotate({
    currentTokenHash: tokenHash,
    newTokenHash,
    expiresAt: buildExpiresAt(rememberMe),
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
    refreshExpiresIn: getRefreshTokenTtlSeconds(rememberMe),
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
