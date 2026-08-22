const assert = require("node:assert/strict");
const test = require("node:test");

const AuthService = require("../src/modules/auth/services/auth.service");
const RefreshTokenService = require("../src/modules/auth/services/refresh-token.service");
const validateAuth = require("../src/modules/auth/middleware/validate-auth.middleware");
const { verifyJwt } = require("../src/modules/auth/utils/jwt");
const { env } = require("../src/config");

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

test("refresh token generator returns opaque high-entropy tokens", () => {
  const firstToken = RefreshTokenService.generateRefreshToken();
  const secondToken = RefreshTokenService.generateRefreshToken();

  assert.equal(typeof firstToken, "string");
  assert.notEqual(firstToken, secondToken);
  assert.ok(firstToken.length >= 80);
});

test("refresh token hashes are deterministic and do not expose plaintext", () => {
  const token = "refresh-token-value";
  const hash = RefreshTokenService.hashRefreshToken(token);

  assert.equal(hash, RefreshTokenService.hashRefreshToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("rememberMe changes refresh token ttl, not access token ttl", () => {
  assert.equal(
    RefreshTokenService.getRefreshTokenTtlSeconds(false),
    env.security.refreshTokenTtlSeconds
  );
  assert.equal(
    RefreshTokenService.getRefreshTokenTtlSeconds(true),
    env.security.refreshTokenRememberMeTtlSeconds
  );

  const user = {
    id: "user-1",
    email: "user@example.com",
    role: "client",
  };

  const regularToken = AuthService.signAccessToken(user, { rememberMe: false });
  const rememberToken = AuthService.signAccessToken(user, { rememberMe: true });
  const regularPayload = verifyJwt(regularToken.accessToken, {
    secret: env.security.jwtSecret,
  });
  const rememberPayload = verifyJwt(rememberToken.accessToken, {
    secret: env.security.jwtSecret,
  });

  assert.equal(regularToken.expiresIn, env.security.jwtExpiresInSeconds);
  assert.equal(rememberToken.expiresIn, env.security.jwtExpiresInSeconds);
  assert.equal(
    regularPayload.exp - regularPayload.iat,
    env.security.jwtExpiresInSeconds
  );
  assert.equal(
    rememberPayload.exp - rememberPayload.iat,
    env.security.jwtExpiresInSeconds
  );
});

test("refresh request requires refreshToken", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.refresh({ body: {} }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "refreshToken is required." });
});

test("refresh request accepts valid body", () => {
  const res = createMockResponse();
  let nextCalled = false;

  validateAuth.refresh(
    { body: { refreshToken: "token", rememberMe: false } },
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});
