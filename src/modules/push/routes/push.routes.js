const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { buildRedisRateLimitStore } = require("../../../middleware/rate-limit.middleware");
const Controller = require("../controllers/push-device.controller");
const router = Router();
function limiter(prefix, limit, bySession = false) {
  return rateLimit({ windowMs: 60000, limit,
    keyGenerator: (req) => bySession ? `${req.auth.userId}:${req.auth.payload.sid || "web"}` : req.auth.userId,
    store: buildRedisRateLimitStore(prefix), standardHeaders: true, legacyHeaders: false,
    message: { message: "Too many push requests. Try again later." } });
}
const devicesLimiter = limiter("rl:push:", 30);
router.post("/devices", devicesLimiter, Controller.register);
router.delete("/devices", devicesLimiter, Controller.unregister);
router.get("/devices", devicesLimiter, Controller.list);
router.patch("/devices/presence", limiter("rl:push:presence:", 60, true), Controller.presence);
router.post("/invitations/presented", limiter("rl:push:presented:", 120, true), Controller.presented);
module.exports = router;
