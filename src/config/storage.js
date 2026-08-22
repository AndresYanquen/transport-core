const { S3Client } = require("@aws-sdk/client-s3");

const { env } = require("./env");

let r2Client = null;

function ensureR2Configured() {
  const config = env.storage.r2;
  const missing = [];

  if (!config.endpoint) missing.push("R2_ENDPOINT or R2_ACCOUNT_ID");
  if (!config.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!config.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!config.bucket) missing.push("R2_BUCKET");
  if (!config.publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");

  if (missing.length) {
    const error = new Error(`Cloudflare R2 is not configured. Missing: ${missing.join(", ")}.`);
    error.status = 503;
    throw error;
  }
}

function getR2Client() {
  ensureR2Configured();

  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: env.storage.r2.endpoint,
      credentials: {
        accessKeyId: env.storage.r2.accessKeyId,
        secretAccessKey: env.storage.r2.secretAccessKey,
      },
    });
  }

  return r2Client;
}

module.exports = {
  ensureR2Configured,
  getR2Client,
};
