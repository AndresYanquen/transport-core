const PhoneAuth = require("../services/phone-auth.service");
const { logger } = require("../../../config/logger");

function handler(operation) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const result = await PhoneAuth[operation](req.phoneAuthPayload, {
        ip: req.ip, userAgent: req.headers["user-agent"] || null,
        linkUser: req.user || null,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error.status) {
        if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
        return res.status(error.status).json({ message: error.message,
          ...(error.code === "ADDITIONAL_FACTOR_REQUIRED" ? { code: error.code } : {}),
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
      }
      // Database constraint messages can include personal data. Keep this flow generic.
      logger.error("phone_otp_internal_error", { operation });
      res.status(503).json({ message: "Phone authentication is temporarily unavailable." });
    }
  };
}

module.exports = { requestOtp: handler("requestOtp"), verifyOtp: handler("verifyOtp") };
