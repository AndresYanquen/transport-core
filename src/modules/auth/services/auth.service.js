const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const AuthModel = require("../models/auth.model");
const { env } = require("../../../config");
const { logger } = require("../../../config/logger");
const { signJwt } = require("../utils/jwt");
const { normalizePhoneNumber } = require("../utils/phone");
const GoogleAuthService = require("./google-auth.service");

const PASSWORD_SALT_ROUNDS = 12;
const VERIFICATION_TOKEN_BYTES = 32;

const allowedAccountTypes = ["client", "driver"];

function toWktPoint(location) {
  if (!location) return null;

  const { lat, latitude, lng, lon, longitude } = location;
  const latitudeValue = typeof latitude === "number" ? latitude : lat;
  const longitudeValue = typeof longitude === "number"
    ? longitude
    : typeof lng === "number"
    ? lng
    : lon;

  if (
    typeof latitudeValue !== "number" ||
    typeof longitudeValue !== "number" ||
    Number.isNaN(latitudeValue) ||
    Number.isNaN(longitudeValue)
  ) {
    return null;
  }

  return `SRID=4326;POINT(${longitudeValue} ${latitudeValue})`;
}

function extractLatLng(location) {
  if (!location) return null;

  const { lat, latitude, lng, lon, longitude } = location;
  const latValue = typeof latitude === "number" ? latitude : lat;
  const lngValue =
    typeof longitude === "number"
      ? longitude
      : typeof lng === "number"
      ? lng
      : lon;

  if (
    typeof latValue === "number" &&
    typeof lngValue === "number" &&
    Number.isFinite(latValue) &&
    Number.isFinite(lngValue)
  ) {
    return { lat: latValue, lng: lngValue };
  }

  return null;
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function splitDisplayName(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return { firstName: null, lastName: null };
  }

  const parts = normalizedName.split(/\s+/);
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function assertUserCanLogin(userRow) {
  if (!userRow) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }

  if (userRow.deleted_at) {
    const error = new Error("User linked to token no longer exists.");
    error.status = 401;
    throw error;
  }

  if (String(userRow.status || "").toLowerCase() !== "active") {
    const error = new Error("User account is not active.");
    error.status = 403;
    throw error;
  }
}

async function ensureGoogleProviderLink(userRow, providerUserId) {
  const linkedProvider = await AuthModel.linkAuthProvider({
    userId: userRow.id,
    provider: "google",
    providerUserId,
  });

  if (linkedProvider) {
    return;
  }

  const linkedUser = await AuthModel.findByAuthProvider("google", providerUserId);
  if (linkedUser?.id === userRow.id) {
    return;
  }

  const error = new Error("Google account is already linked to another user.");
  error.status = 409;
  throw error;
}

async function buildLoginSession(userRow, { rememberMe = false } = {}) {
  assertUserCanLogin(userRow);

  const updatedRow = await AuthModel.updateLastLogin(userRow.id);
  const user = AuthModel.toPublicUser(updatedRow ?? userRow);

  const accessTokenExpiresInSeconds = rememberMe
    ? env.security.jwtRememberMeExpiresInSeconds
    : env.security.jwtExpiresInSeconds;

  const accessToken = signJwt(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      type: "access",
    },
    {
      secret: env.security.jwtSecret,
      expiresInSeconds: accessTokenExpiresInSeconds,
    }
  );

  return {
    user,
    token: accessToken,
    expiresIn: accessTokenExpiresInSeconds,
    rememberMe: Boolean(rememberMe),
  };
}

async function registerUser({
  email,
  password,
  firstName,
  lastName,
  phoneNumber,
  username,
  accountType = "client",
  clientProfile = {},
  driverProfile = {},
}) {
  if (!allowedAccountTypes.includes(accountType)) {
    const error = new Error(
      `accountType must be one of: ${allowedAccountTypes.join(", ")}.`
    );
    error.status = 400;
    throw error;
  }

  const normalizedAccountType = accountType;

  if (
    normalizedAccountType === "driver" &&
    (!driverProfile ||
      !driverProfile.licenseNumber ||
      !driverProfile.vehicleMake ||
      !driverProfile.vehicleModel ||
      !driverProfile.vehiclePlate)
  ) {
    const error = new Error(
      "Driver registrations require licenseNumber, vehicleMake, vehicleModel, and vehiclePlate."
    );
    error.status = 400;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  const emailVerificationToken = generateToken(VERIFICATION_TOKEN_BYTES);
  const normalizedPhoneNumber = phoneNumber ? normalizePhoneNumber(phoneNumber) : null;
  const phoneVerificationToken = normalizedPhoneNumber
    ? generateToken(VERIFICATION_TOKEN_BYTES)
    : null;

  const createdAt = new Date();

  const normalizedDriverProfile = driverProfile
    ? {
        ...driverProfile,
        vehicleYear:
          driverProfile.vehicleYear !== undefined && driverProfile.vehicleYear !== null
            ? Number(driverProfile.vehicleYear)
            : null,
        currentLocationWkt: toWktPoint(driverProfile.currentLocation),
        currentLocationLatLng: extractLatLng(driverProfile.currentLocation),
      }
    : undefined;

  const normalizedClientProfile = clientProfile
    ? {
        ...clientProfile,
        homeLocationWkt: toWktPoint(clientProfile.homeLocation),
      }
    : undefined;

  const userRow = await AuthModel.createUser({
    email,
    username,
    passwordHash,
    firstName,
    lastName,
    phoneNumber: normalizedPhoneNumber,
    accountType: normalizedAccountType,
    emailVerificationToken: hashToken(emailVerificationToken),
    emailVerificationSentAt: createdAt,
    phoneVerificationToken: phoneVerificationToken
      ? hashToken(phoneVerificationToken)
      : null,
    phoneVerificationSentAt: phoneVerificationToken ? createdAt : null,
    clientProfile:
      normalizedAccountType === "client" ? normalizedClientProfile : undefined,
    driverProfile:
      normalizedAccountType === "driver" ? normalizedDriverProfile : undefined,
  });

  const user = AuthModel.toPublicUser(userRow);

  return {
    user,
    verification: {
      emailToken: emailVerificationToken,
      phoneToken: phoneVerificationToken,
    },
  };
}

async function loginUser({ email, password, rememberMe = false }) {
  const userRow = await AuthModel.findByEmail(email);

  if (!userRow || !userRow.password_hash) {
    const error = new Error("Contraseña o correo inválidos.");
    error.status = 401;
    throw error;
  }

  const passwordMatches = await bcrypt.compare(
    password,
    userRow.password_hash
  );

  if (!passwordMatches) {
    const error = new Error("Contraseña o correo inválidos.");
    error.status = 401;
    throw error;
  }

  return buildLoginSession(userRow, { rememberMe });
}

async function loginWithGoogle({ idToken, rememberMe = false }) {
  let googleIdentity;
  try {
    googleIdentity = await GoogleAuthService.verifyGoogleIdToken(idToken);
  } catch (error) {
    logger.warn("google_auth_invalid_token", {
      error: { message: error.message, status: error.status },
    });
    throw error;
  }

  let userRow = await AuthModel.findByAuthProvider(
    "google",
    googleIdentity.providerUserId
  );

  if (userRow) {
    logger.info("google_auth_success", {
      userId: userRow.id,
      provider: "google",
    });
    return buildLoginSession(userRow, { rememberMe });
  }

  userRow = await AuthModel.findByEmail(googleIdentity.email);

  if (userRow) {
    await ensureGoogleProviderLink(userRow, googleIdentity.providerUserId);
    userRow = await AuthModel.markEmailVerified(userRow.id) || userRow;

    logger.info("google_auth_provider_linked", {
      userId: userRow.id,
      provider: "google",
    });

    return buildLoginSession(userRow, { rememberMe });
  }

  const { firstName, lastName } = splitDisplayName(googleIdentity.name);
  userRow = await AuthModel.createGoogleClientUser({
    email: googleIdentity.email,
    firstName,
    lastName,
    providerUserId: googleIdentity.providerUserId,
    profile: {
      google: {
        name: googleIdentity.name,
        picture: googleIdentity.picture,
      },
    },
  });

  await ensureGoogleProviderLink(userRow, googleIdentity.providerUserId);
  userRow = await AuthModel.markEmailVerified(userRow.id) || userRow;

  logger.info("google_auth_user_created", {
    userId: userRow.id,
    provider: "google",
  });

  return buildLoginSession(userRow, { rememberMe });
}

async function getCurrentUser(authenticatedUser) {
  if (!authenticatedUser || !authenticatedUser.id) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }

  return {
    user: authenticatedUser,
  };
}

module.exports = {
  registerUser,
  loginUser,
  loginWithGoogle,
  getCurrentUser,
  buildLoginSession,
};
