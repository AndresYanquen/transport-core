const { OAuth2Client } = require("google-auth-library");

const { env } = require("../../../config");

const googleClient = new OAuth2Client(env.google.clientId);

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePayload(payload) {
  if (!payload?.sub) {
    throw createHttpError("Google token is missing subject.", 401);
  }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    throw createHttpError("Google token is missing email.", 401);
  }

  if (payload.email_verified !== true) {
    throw createHttpError("Google email must be verified.", 401);
  }

  return {
    providerUserId: String(payload.sub),
    email,
    emailVerified: true,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}

async function verifyGoogleIdToken(idToken) {
  if (!env.google.clientId) {
    throw createHttpError("Google authentication is not configured.", 503);
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.google.clientId,
    });

    return normalizePayload(ticket.getPayload());
  } catch (error) {
    if (error.status) {
      throw error;
    }

    throw createHttpError("Invalid Google token.", 401);
  }
}

module.exports = {
  normalizePayload,
  verifyGoogleIdToken,
};
