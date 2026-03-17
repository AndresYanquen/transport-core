const crypto = require("crypto");

function createUnauthorizedError(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(segment) {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(pad);
  return Buffer.from(padded, "base64");
}

function createSignature(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest();
}

function signJwt(payload, { secret, expiresInSeconds = 3600 } = {}) {
  if (!secret) {
    throw new Error("JWT secret must be provided to sign a token.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const tokenPayload = {
    ...payload,
    iat: issuedAt,
    exp: expiresInSeconds > 0 ? issuedAt + Number(expiresInSeconds) : undefined,
  };

  const headerSegment = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadSegment = base64UrlEncode(Buffer.from(JSON.stringify(tokenPayload)));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = createSignature(signingInput, secret);
  const signatureSegment = base64UrlEncode(signature);

  return `${signingInput}.${signatureSegment}`;
}

function verifyJwt(token, { secret, clockToleranceSeconds = 0 } = {}) {
  if (!token) {
    throw createUnauthorizedError("Authorization token missing.");
  }

  if (!secret) {
    throw new Error("JWT secret must be provided to verify a token.");
  }

  const segments = token.split(".");

  if (segments.length !== 3) {
    throw createUnauthorizedError("Malformed authorization token.");
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;

  let header;
  try {
    header = JSON.parse(base64UrlDecode(headerSegment).toString("utf8"));
  } catch (_err) {
    throw createUnauthorizedError("Invalid token header.");
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw createUnauthorizedError("Unsupported token header.");
  }

  const signingInput = `${headerSegment}.${payloadSegment}`;
  const expectedSignature = createSignature(signingInput, secret);
  const receivedSignature = base64UrlDecode(signatureSegment);

  if (
    expectedSignature.length !== receivedSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    throw createUnauthorizedError("Invalid token signature.");
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadSegment).toString("utf8"));
  } catch (_err) {
    throw createUnauthorizedError("Invalid token payload.");
  }

  if (payload.exp) {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > payload.exp + Number(clockToleranceSeconds)) {
      throw createUnauthorizedError("Authorization token has expired.");
    }
  }

  return payload;
}

module.exports = {
  signJwt,
  verifyJwt,
};
