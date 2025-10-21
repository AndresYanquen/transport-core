const { Router } = require("express");

const AuthController = require("../controllers/auth.controller");
const validateAuth = require("../middleware/validate-auth.middleware");

const router = Router();

router.post("/signup", validateAuth.signup, AuthController.signup);
router.post("/login", validateAuth.login, AuthController.login);

module.exports = router;
