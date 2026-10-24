const { Router } = require("express");

const AuthController = require("../controllers/auth.controller");
const validateAuth = require("../middleware/validate-auth.middleware");
const { authenticate } = require("../middleware/authentication.middleware");
const PhoneAuthController = require("../controllers/phone-auth.controller");
const validatePhoneAuth = require("../middleware/validate-phone-auth.middleware");

const router = Router();

router.post("/phone/request-otp", validatePhoneAuth.requestOtp, PhoneAuthController.requestOtp);
router.post("/phone/verify-otp", validatePhoneAuth.verifyOtp, PhoneAuthController.verifyOtp);
router.post("/phone/link/request-otp", authenticate, validatePhoneAuth.requestOtp, PhoneAuthController.requestOtp);
router.post("/phone/link/verify-otp", authenticate, validatePhoneAuth.verifyOtp, PhoneAuthController.verifyOtp);

router.post("/signup", validateAuth.signup, AuthController.signup);
router.post("/login", validateAuth.login, AuthController.login);
router.post("/google", validateAuth.google, AuthController.google);
router.post("/refresh", validateAuth.refresh, AuthController.refresh);
router.post("/logout", validateAuth.logout, AuthController.logout);
router.post("/logout-all", authenticate, AuthController.logoutAll);
router.post("/forgot-password", validateAuth.forgotPassword, AuthController.forgotPassword);
router.post("/reset-password", validateAuth.resetPassword, AuthController.resetPassword);
router.post("/verify-email", validateAuth.verifyEmail, AuthController.verifyEmail);
router.get("/me", authenticate, AuthController.me);

module.exports = router;
