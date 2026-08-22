const AuthService = require("../services/auth.service");

function getAuthMetadata(req) {
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"] || null,
  };
}

async function signup(req, res, next) {
  try {
    const result = await AuthService.registerUser(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const session = await AuthService.loginUser(req.body, getAuthMetadata(req));
    res.status(200).json(session);
  } catch (error) {
    next(error);
  }
}

async function google(req, res, next) {
  try {
    const session = await AuthService.loginWithGoogle(req.body, getAuthMetadata(req));
    res.status(200).json(session);
  } catch (error) {
    next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const session = await AuthService.refreshSession(req.body, getAuthMetadata(req));
    res.status(200).json(session);
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    const result = await AuthService.logoutUser(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function logoutAll(req, res, next) {
  try {
    const result = await AuthService.logoutAll(req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    const result = await AuthService.getCurrentUser(req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  signup,
  login,
  google,
  refresh,
  logout,
  logoutAll,
  me,
};
