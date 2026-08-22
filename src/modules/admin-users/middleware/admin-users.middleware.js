const allowedRoles = ["admin", "operator", "client", "driver"];
const allowedStatuses = ["active", "inactive", "suspended"];
const allowedApprovalStatuses = ["pending", "approved", "rejected", "changes_requested", "suspended"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateCreateUser(req, res, next) {
  const body = req.body || {};
  const {
    email,
    password,
    role = "client",
    status = "active",
    driverProfile,
    clientProfile,
  } = body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ message: "Email must be valid." });
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({
      message: "Password must be at least 6 characters long.",
    });
  }

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({
      message: `role must be one of: ${allowedRoles.join(", ")}.`,
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      message: `status must be one of: ${allowedStatuses.join(", ")}.`,
    });
  }

  if (role === "driver") {
    const profile = driverProfile || {};
    const requiredFields = [
      "licenseNumber",
      "vehicleMake",
      "vehicleModel",
      "vehiclePlate",
    ];

    for (const field of requiredFields) {
      if (!profile[field]) {
        return res.status(400).json({
          message: `driverProfile.${field} is required for driver users.`,
        });
      }
    }
  }

  if (clientProfile && typeof clientProfile !== "object") {
    return res.status(400).json({
      message: "clientProfile must be an object when provided.",
    });
  }

  if (driverProfile && typeof driverProfile !== "object") {
    return res.status(400).json({
      message: "driverProfile must be an object when provided.",
    });
  }

  req.adminUserPayload = body;
  next();
}

function validateListUsers(req, _res, next) {
  const limit = Number(req.query.limit || 50);
  const offset = Number(req.query.offset || 0);
  const role = req.query.role ? String(req.query.role) : "";
  const search = req.query.search ? String(req.query.search) : "";

  req.adminUsersQuery = {
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50,
    offset: Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0,
    role: allowedRoles.includes(role) ? role : "",
    search: search.trim(),
  };

  next();
}

function validateListDriverApprovals(req, res, next) {
  const limit = Number(req.query.limit || 100);
  const offset = Number(req.query.offset || 0);
  const status = req.query.status ? String(req.query.status) : "pending";
  const search = req.query.search ? String(req.query.search).trim() : "";

  if (status !== "all" && !allowedApprovalStatuses.includes(status)) {
    return res.status(400).json({
      message: `status must be all or one of: ${allowedApprovalStatuses.join(", ")}.`,
    });
  }

  req.adminDriverApprovalsQuery = {
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 100,
    offset: Number.isFinite(offset) ? Math.max(Math.trunc(offset), 0) : 0,
    status,
    search,
  };

  next();
}

function validateDriverApproval(req, res, next) {
  const driverId = String(req.params.driverId || "");
  const approvalStatus = String(req.body?.approvalStatus || "");
  const approvalNotes = req.body?.approvalNotes === undefined ? "" : String(req.body.approvalNotes);

  if (!UUID_PATTERN.test(driverId)) {
    return res.status(400).json({ message: "driverId must be a valid UUID." });
  }

  if (!allowedApprovalStatuses.includes(approvalStatus)) {
    return res.status(400).json({
      message: `approvalStatus must be one of: ${allowedApprovalStatuses.join(", ")}.`,
    });
  }

  req.adminDriverId = driverId;
  req.adminDriverApprovalPayload = {
    approvalStatus,
    approvalNotes: approvalNotes.trim().slice(0, 2000),
  };

  next();
}

module.exports = {
  validateCreateUser,
  validateDriverApproval,
  validateListDriverApprovals,
  validateListUsers,
};
