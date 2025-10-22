const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const AuthModel = require("../models/auth.model");

const PASSWORD_SALT_ROUNDS = 12;
const SESSION_TOKEN_BYTES = 32;
const VERIFICATION_TOKEN_BYTES = 32;

const allowedAccountTypes = ["client", "driver", "admin"];

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
      }
    : undefined;

  const normalizedClientProfile = clientProfile
    ? {
        ...clientProfile,
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

async function loginUser({ email, password }) {
  const userRow = await AuthModel.findByEmail(email);

  if (!userRow) {
    const error = new Error("Invalid email or password.");
    error.status = 401;
    throw error;
  }

  const passwordMatches = await bcrypt.compare(
    password,
    userRow.password_hash
  );

  if (!passwordMatches) {
    const error = new Error("Invalid email or password.");
    error.status = 401;
    throw error;
  }

  const updatedRow = await AuthModel.updateLastLogin(userRow.id);

  const sessionToken = generateToken(SESSION_TOKEN_BYTES);

  return {
    user: AuthModel.toPublicUser(updatedRow ?? userRow),
    token: sessionToken,
  };
}

module.exports = {
  registerUser,
  loginUser,
};
