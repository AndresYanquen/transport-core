const AuthService = require("../services/auth.service");

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
    const session = await AuthService.loginUser(req.body);
    res.status(200).json(session);
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
  me,
};
