const assert = require("node:assert/strict");
const test = require("node:test");

const GoogleAuthService = require("../src/modules/auth/services/google-auth.service");
const validateAuth = require("../src/modules/auth/middleware/validate-auth.middleware");
const AuthService = require("../src/modules/auth/services/auth.service");

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

test("normalizes verified Google token payload", () => {
  const identity = GoogleAuthService.normalizePayload({
    sub: "google-user-1",
    email: " User@Example.COM ",
    email_verified: true,
    name: "Test User",
    picture: "https://example.com/avatar.png",
  });

  assert.deepEqual(identity, {
    providerUserId: "google-user-1",
    email: "user@example.com",
    emailVerified: true,
    name: "Test User",
    picture: "https://example.com/avatar.png",
  });
});

test("rejects Google payload with unverified email", () => {
  assert.throws(
    () => GoogleAuthService.normalizePayload({
      sub: "google-user-1",
      email: "user@example.com",
      email_verified: false,
    }),
    /Google email must be verified/
  );
});

test("rejects Google login request without idToken", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.google({ body: {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "idToken is required." });
});

test("rejects Google login request with non-boolean rememberMe", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.google(
    { body: { idToken: "token", rememberMe: "yes" } },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    message: "rememberMe must be a boolean when provided.",
  });
});

test("accepts valid Google login request shape", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.google(
    { body: { idToken: "token", rememberMe: true } },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("does not issue sessions for inactive users", async () => {
  await assert.rejects(
    () => AuthService.buildLoginSession({
      id: "user-1",
      email: "user@example.com",
      role: "client",
      status: "blocked",
    }),
    (error) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /not active/);
      return true;
    }
  );
});
