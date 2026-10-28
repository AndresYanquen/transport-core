const Model = require("../models/push-device.model");
const Sessions = require("../../auth/services/mobile-session.service");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bad(message) { throw Object.assign(new Error(message), { status: 400 }); }
function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) bad("A JSON object is required.");
}
function validateToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096 || /\s/.test(token)) bad("Invalid push token.");
  return token;
}
async function context(auth, installationId) {
  if (installationId !== undefined && (typeof installationId !== "string" || !UUID.test(installationId))) bad("installationId must be a UUID.");
  const sessionId = auth.payload.sid || null;
  if (sessionId) {
    const session = await Sessions.assertActive(sessionId, auth.userId);
    if (installationId && installationId.toLowerCase() !== session.installation_id.toLowerCase()) bad("Installation does not match the authenticated session.");
    return { sessionId, installationId: session.installation_id };
  }
  if (!["admin", "operator"].includes(auth.role)) throw Sessions.requireOtp();
  return { sessionId: null, installationId };
}
async function register(auth, body = {}) {
  validateBody(body);
  const token = validateToken(body.token);
  if (!["android", "ios", "web"].includes(body.platform)) bad("platform must be android, ios or web.");
  const ctx = await context(auth, body.installationId);
  if (!ctx.installationId) bad("installationId is required for web administrative sessions.");
  if (!ctx.sessionId && body.platform !== "web") bad("Mobile push requires an installation session.");
  return Model.register({ ...ctx, userId: auth.userId, token, platform: body.platform,
    securityVersion: auth.payload.cv || 0,
    authorizedUntil: ctx.sessionId ? null : new Date(auth.payload.exp * 1000) });
}
async function unregister(auth, body = {}) {
  validateBody(body);
  const ctx = await context(auth, body.installationId);
  if (!body.token && !ctx.installationId) bad("token or installationId is required.");
  if (body.token !== undefined) validateToken(body.token);
  await Model.unregister({ ...ctx, userId: auth.userId, token: body.token });
}
module.exports = { register, unregister, validateToken, context };
