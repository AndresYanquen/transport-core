const assert = require("node:assert/strict");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const AuthService = require("../src/modules/auth/services/auth.service");
const AuthModel = require("../src/modules/auth/models/auth.model");
const PasswordResetTokenModel = require("../src/modules/auth/models/password-reset-token.model");
const RefreshTokenService = require("../src/modules/auth/services/refresh-token.service");
const EmailService = require("../src/modules/email/services/email.service");
const validateAuth = require("../src/modules/auth/middleware/validate-auth.middleware");

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("forgot password validates email", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.forgotPassword({ body: {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Email is required." });
});

test("reset password validates token and password", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.resetPassword({ body: { token: "token" } }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Token and password are required." });
});

test("password reset request is generic for unknown emails", async () => {
  const originalFindByEmail = AuthModel.findByEmail;
  AuthModel.findByEmail = async () => null;

  try {
    const result = await AuthService.requestPasswordReset({
      email: "missing@example.com",
    });

    assert.deepEqual(result, {
      message:
        "Si el correo existe, enviaremos instrucciones para restablecer la contraseña.",
    });
  } finally {
    AuthModel.findByEmail = originalFindByEmail;
  }
});

test("password reset request stores hashed token and sends email", async () => {
  const originalFindByEmail = AuthModel.findByEmail;
  const originalRevokeUnusedForUser = PasswordResetTokenModel.revokeUnusedForUser;
  const originalCreate = PasswordResetTokenModel.create;
  const originalSendPasswordResetEmail = EmailService.sendPasswordResetEmail;
  const calls = {};

  AuthModel.findByEmail = async () => ({
    id: "user-1",
    email: "user@example.com",
    password_hash: "hash",
  });
  PasswordResetTokenModel.revokeUnusedForUser = async (userId) => {
    calls.revokedFor = userId;
    return [];
  };
  PasswordResetTokenModel.create = async (payload) => {
    calls.created = payload;
    return payload;
  };
  EmailService.sendPasswordResetEmail = async (payload) => {
    calls.email = payload;
    return { messageId: "message-1" };
  };

  try {
    await AuthService.requestPasswordReset({ email: "user@example.com" });

    assert.equal(calls.revokedFor, "user-1");
    assert.equal(calls.created.userId, "user-1");
    assert.match(calls.created.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(calls.email.to, "user@example.com");
    assert.match(calls.email.resetUrl, /\/reset-password\?token=/);
    assert.ok(!calls.email.resetUrl.includes(calls.created.tokenHash));
  } finally {
    AuthModel.findByEmail = originalFindByEmail;
    PasswordResetTokenModel.revokeUnusedForUser = originalRevokeUnusedForUser;
    PasswordResetTokenModel.create = originalCreate;
    EmailService.sendPasswordResetEmail = originalSendPasswordResetEmail;
  }
});

test("reset password delegates consumption, password update and session revocation atomically", async (t) => {
  const token = "plain-reset-token";
  const hash = AuthService.hashToken(token);
  t.mock.method(PasswordResetTokenModel, "findByHash", async () => ({ user_id: "user-1", token_hash: hash,
    expires_at: new Date(Date.now() + 60000), used_at: null }));
  t.mock.method(AuthModel, "findById", async () => ({ id: "user-1", status: "active" }));
  const consume = t.mock.method(PasswordResetTokenModel, "consumeAndResetPassword", async (input) => {
    assert.equal(input.tokenHash, hash);
    assert.equal(await bcrypt.compare("NewPassword123!", input.passwordHash), true);
    return true;
  });
  assert.deepEqual(await AuthService.resetPassword({ token, password: "NewPassword123!" }), { success: true });
  assert.equal(consume.mock.callCount(), 1);
});

test("reset password rejects expired tokens", async () => {
  const originalFindByHash = PasswordResetTokenModel.findByHash;
  PasswordResetTokenModel.findByHash = async () => ({
    user_id: "user-1",
    expires_at: new Date(Date.now() - 1000),
    used_at: null,
  });

  try {
    await assert.rejects(
      () => AuthService.resetPassword({ token: "token", password: "Password123!" }),
      (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /inválido o expiró/);
        return true;
      }
    );
  } finally {
    PasswordResetTokenModel.findByHash = originalFindByHash;
  }
});
