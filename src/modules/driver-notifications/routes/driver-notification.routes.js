const { Router } = require("express");
const Controller = require("../controllers/driver-notification.controller");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();

router.post("/panic", authorizeRoles("driver"), Controller.createPanicAlert);
router.get("/", authorizeRoles("operator", "admin"), Controller.listNotifications);
router.patch(
  "/:notificationId/acknowledge",
  authorizeRoles("operator", "admin"),
  Controller.acknowledgeNotification
);
router.patch(
  "/:notificationId/resolve",
  authorizeRoles("operator", "admin"),
  Controller.resolveNotification
);

module.exports = router;
