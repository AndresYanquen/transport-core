const allowedRoles = ["admin", "operator", "client", "driver"];
const allowedStatuses = ["active", "inactive", "suspended"];

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

module.exports = {
  validateCreateUser,
  validateListUsers,
};
