const allowedAccountTypes = ["client", "driver", "admin"];

function validateEmailAndPassword(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required." });
    return false;
  }

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ message: "Email and password must be strings." });
    return false;
  }

  if (!email.includes("@")) {
    res.status(400).json({ message: "Email must be valid." });
    return false;
  }

  if (password.length < 6) {
    res
      .status(400)
      .json({ message: "Password must be at least 6 characters long." });
    return false;
  }

  return true;
}

function validateSignup(req, res, next) {
  if (!validateEmailAndPassword(req, res)) {
    return;
  }

  const { accountType = "client", driverProfile, clientProfile } = req.body || {};

  if (!allowedAccountTypes.includes(accountType)) {
    return res.status(400).json({
      message: `accountType must be one of: ${allowedAccountTypes.join(", ")}.`,
    });
  }

  if (accountType === "driver") {
    const profile = driverProfile || {};
    const requiredFields = [
      { key: "licenseNumber", label: "licenseNumber" },
      { key: "vehicleMake", label: "vehicleMake" },
      { key: "vehicleModel", label: "vehicleModel" },
      { key: "vehiclePlate", label: "vehiclePlate" },
    ];

    for (const field of requiredFields) {
      if (!profile[field.key]) {
        return res.status(400).json({
          message: `Driver ${field.label} is required for driver registrations.`,
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

  next();
}

function validateLogin(req, res, next) {
  if (!validateEmailAndPassword(req, res)) {
    return;
  }

  const { rememberMe } = req.body || {};

  if (rememberMe !== undefined && typeof rememberMe !== "boolean") {
    return res.status(400).json({
      message: "rememberMe must be a boolean when provided.",
    });
  }

  next();
}

module.exports = {
  signup: validateSignup,
  login: validateLogin,
};
