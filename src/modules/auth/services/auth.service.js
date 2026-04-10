const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const AuthModel = require("../models/auth.model");
const { env } = require("../../../config");
const { signJwt } = require("../utils/jwt");

const PASSWORD_SALT_ROUNDS = 12;
const VERIFICATION_TOKEN_BYTES = 32;

const allowedAccountTypes = ["client", "driver", "admin"];

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
  const normalizedAccountType = allowedAccountTypes.includes(accountType)
    ? accountType
    : "client";

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
  const phoneVerificationToken = phoneNumber
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
    phoneNumber,
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

  if (!userRow) {
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
  getCurrentUser,
};
