function validateBody(req, res, next) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required.",
    });
  }

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({
      message: "Email and password must be strings.",
    });
  }

  if (!email.includes("@")) {
    return res.status(400).json({
      message: "Email must be valid.",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      message: "Password must be at least 6 characters long.",
    });
  }

  next();
}

module.exports = {
  signup: validateBody,
  login: validateBody,
};
