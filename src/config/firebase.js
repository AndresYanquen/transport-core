const fs = require("node:fs");
const { env } = require("./env");
const { logger } = require("./logger");
let messaging = null;

// Initialization never logs provider errors: they may contain credential material.
function initializeFirebase() {
  if (messaging || !env.push.enabled) return messaging;
  try {
    const { initializeApp, getApps, cert, applicationDefault } = require("firebase-admin/app");
    const { getMessaging } = require("firebase-admin/messaging");
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (raw && file) throw new Error("Ambiguous credentials");
    let credential;
    if (raw || file) {
      const account = JSON.parse(raw || fs.readFileSync(file, "utf8"));
      if (account.type !== "service_account" || account.project_id !== env.push.projectId ||
          !account.client_email || !account.private_key) throw new Error("Invalid service account");
      credential = cert(account);
    } else {
      credential = applicationDefault();
    }
    const app = getApps().find((item) => item.name === "gottaxi-push") ||
      initializeApp({ projectId: env.push.projectId, credential }, "gottaxi-push");
    messaging = getMessaging(app);
    logger.info("push_initialized", { projectId: env.push.projectId });
  } catch {
    logger.warn("push_unavailable", { reason: "configuration_invalid", projectId: env.push.projectId });
  }
  return messaging;
}
function getMessaging() { return messaging; }
module.exports = { initializeFirebase, getMessaging };
