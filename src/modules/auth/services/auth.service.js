const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const AuthModel = require("../models/auth.model");

const PASSWORD_SALT_ROUNDS = 12;
const SESSION_TOKEN_BYTES = 32;
const VERIFICATION_TOKEN_BYTES = 32;

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
}) {
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  const emailVerificationToken = generateToken(VERIFICATION_TOKEN_BYTES);
  const phoneVerificationToken = phoneNumber
    ? generateToken(VERIFICATION_TOKEN_BYTES)
    : null;

  const createdAt = new Date();

  const userRow = await AuthModel.createUser({
    email,
    username,
    passwordHash,
    firstName,
    lastName,
    phoneNumber,
    emailVerificationToken: hashToken(emailVerificationToken),
    emailVerificationSentAt: createdAt,
    phoneVerificationToken: phoneVerificationToken
      ? hashToken(phoneVerificationToken)
      : null,
    phoneVerificationSentAt: phoneVerificationToken ? createdAt : null,
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
