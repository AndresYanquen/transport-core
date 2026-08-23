const test = require("node:test");
const assert = require("node:assert/strict");

const AdminUsersMiddleware = require("../src/modules/admin-users/middleware/admin-users.middleware");

function runMiddleware(middleware, { body = {}, params = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { body, params, query };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve({ req, res: this, nextCalled: false });
      },
    };

    middleware(req, res, () => {
      resolve({ req, res, nextCalled: true });
    });
  });
}

test("driver approval validation accepts canonical approval fields", async () => {
  const driverId = "123e4567-e89b-42d3-a456-426614174000";
  const result = await runMiddleware(AdminUsersMiddleware.validateDriverApproval, {
    params: { driverId },
    body: { approvalStatus: "approved", approvalNotes: "Documents verified" },
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.adminDriverId, driverId);
  assert.deepEqual(result.req.adminDriverApprovalPayload, {
    approvalStatus: "approved",
    approvalNotes: "Documents verified",
  });
});

test("driver approval validation accepts status and notes aliases", async () => {
  const driverId = "123e4567-e89b-42d3-a456-426614174000";
  const result = await runMiddleware(AdminUsersMiddleware.validateDriverApproval, {
    params: { driverId },
    body: { status: "changes_requested", notes: "Missing license photo" },
  });

  assert.equal(result.nextCalled, true);
  assert.deepEqual(result.req.adminDriverApprovalPayload, {
    approvalStatus: "changes_requested",
    approvalNotes: "Missing license photo",
  });
});

test("driver approval validation rejects unsupported statuses", async () => {
  const result = await runMiddleware(AdminUsersMiddleware.validateDriverApproval, {
    params: { driverId: "123e4567-e89b-42d3-a456-426614174000" },
    body: { status: "unknown" },
  });

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.body.message, /approvalStatus/);
});
