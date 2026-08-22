const crypto = require("crypto");
const { DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const AuthModel = require("../../auth/models/auth.model");
const { env } = require("../../../config");
const { query } = require("../../../config/database");
const { getR2Client } = require("../../../config/storage");

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertClientOrDriver(user) {
  if (!["client", "driver"].includes(String(user?.role || "").toLowerCase())) {
    throw httpError(403, "Only clients and drivers can update profile images.");
  }
}

function validateImageFile(file) {
  if (!file) {
    throw httpError(400, "profileImage file is required.");
  }

  if (!allowedImageTypes.has(file.mimetype)) {
    throw httpError(400, "profileImage must be JPEG, PNG, or WEBP.");
  }

  if (!file.size || file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw httpError(400, "profileImage must be 5 MB or smaller.");
  }

  const signature = file.buffer?.subarray(0, 12);
  const isJpeg = signature?.[0] === 0xff && signature?.[1] === 0xd8 && signature?.[2] === 0xff;
  const isPng =
    signature?.[0] === 0x89 &&
    signature?.[1] === 0x50 &&
    signature?.[2] === 0x4e &&
    signature?.[3] === 0x47;
  const isWebp =
    signature?.subarray(0, 4).toString("ascii") === "RIFF" &&
    signature?.subarray(8, 12).toString("ascii") === "WEBP";

  if (
    (file.mimetype === "image/jpeg" && !isJpeg) ||
    (file.mimetype === "image/png" && !isPng) ||
    (file.mimetype === "image/webp" && !isWebp)
  ) {
    throw httpError(400, "profileImage content does not match its declared image type.");
  }
}

function buildProfileImageKey(userId, mimetype) {
  const extension = allowedImageTypes.get(mimetype);
  const random = crypto.randomBytes(12).toString("hex");
  return `users/${userId}/profile/${Date.now()}-${random}.${extension}`;
}

function publicUrlForKey(key) {
  return `${env.storage.r2.publicBaseUrl}/${key}`;
}

async function updateUserProfileImage(userId, { key, url }) {
  const { rows } = await query(
    `
      UPDATE users
      SET
        profile_image_key = $2,
        profile_image_url = $3,
        profile_image_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id
    `,
    [userId, key, url]
  );

  if (!rows[0]) {
    throw httpError(404, "User not found.");
  }

  return AuthModel.findById(userId);
}

async function clearUserProfileImage(userId) {
  const { rows } = await query(
    `
      UPDATE users
      SET
        profile_image_key = NULL,
        profile_image_url = NULL,
        profile_image_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id
    `,
    [userId]
  );

  if (!rows[0]) {
    throw httpError(404, "User not found.");
  }

  return AuthModel.findById(userId);
}

async function deleteObjectBestEffort(key) {
  if (!key) return;

  try {
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: env.storage.r2.bucket,
        Key: key,
      })
    );
  } catch (_error) {}
}

async function uploadProfileImage(user, file) {
  assertClientOrDriver(user);
  validateImageFile(file);

  const currentUser = await AuthModel.findById(user.id);
  if (!currentUser) {
    throw httpError(404, "User not found.");
  }

  const key = buildProfileImageKey(user.id, file.mimetype);
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: env.storage.r2.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  const updatedRow = await updateUserProfileImage(user.id, {
    key,
    url: publicUrlForKey(key),
  });

  await deleteObjectBestEffort(currentUser.profile_image_key);

  return {
    user: AuthModel.toPublicUser(updatedRow),
  };
}

async function deleteProfileImage(user) {
  assertClientOrDriver(user);

  const currentUser = await AuthModel.findById(user.id);
  if (!currentUser) {
    throw httpError(404, "User not found.");
  }

  const updatedRow = await clearUserProfileImage(user.id);
  await deleteObjectBestEffort(currentUser.profile_image_key);

  return {
    user: AuthModel.toPublicUser(updatedRow),
  };
}

module.exports = {
  MAX_PROFILE_IMAGE_BYTES,
  uploadProfileImage,
  deleteProfileImage,
  __private: {
    allowedImageTypes,
    buildProfileImageKey,
    validateImageFile,
  },
};
