const allowedAccountTypes = ["client", "driver"];

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

function validateGoogleLogin(req, res, next) {
  const { idToken, rememberMe } = req.body || {};

  if (!idToken) {
    return res.status(400).json({ message: "idToken is required." });
  }

  if (typeof idToken !== "string") {
    return res.status(400).json({ message: "idToken must be a string." });
  }

  if (rememberMe !== undefined && typeof rememberMe !== "boolean") {
    return res.status(400).json({
      message: "rememberMe must be a boolean when provided.",
    });
  }

  next();
}

function validateRefreshToken(req, res, next) {
  const { refreshToken, rememberMe } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({ message: "refreshToken is required." });
  }

  if (typeof refreshToken !== "string") {
    return res.status(400).json({ message: "refreshToken must be a string." });
  }

  if (rememberMe !== undefined && typeof rememberMe !== "boolean") {
    return res.status(400).json({
      message: "rememberMe must be a boolean when provided.",
    });
  }

  next();
}

function validateForgotPassword(req, res, next) {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  if (typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ message: "Email must be valid." });
  }

  next();
}

function validateResetPassword(req, res, next) {
  const { token, password } = req.body || {};

  if (!token || !password) {
    return res.status(400).json({ message: "Token and password are required." });
  }

  if (typeof token !== "string" || typeof password !== "string") {
    return res.status(400).json({ message: "Token and password must be strings." });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters long." });
  }

  next();
}

function validateVerifyEmail(req, res, next) {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ message: "Token is required." });
  }

  if (typeof token !== "string") {
    return res.status(400).json({ message: "Token must be a string." });
  }

  next();
}

module.exports = {
  signup: validateSignup,
  login: validateLogin,
  google: validateGoogleLogin,
  refresh: validateRefreshToken,
  logout: validateRefreshToken,
  forgotPassword: validateForgotPassword,
  resetPassword: validateResetPassword,
  verifyEmail: validateVerifyEmail,
};
