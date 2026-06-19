const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminZonesController = require("../controllers/admin-zones.controller");
const AdminZonesMiddleware = require("../middleware/admin-zones.middleware");

const router = Router();

router.get("/", authorizeRoles("admin"), AdminZonesController.listZones);

router.post(
  "/",
  authorizeRoles("admin"),
  AdminZonesMiddleware.validateCreateZone,
  AdminZonesController.createZone
);

router.put(
  "/:zoneId",
  authorizeRoles("admin"),
  AdminZonesMiddleware.validateZoneId,
  AdminZonesMiddleware.validateCreateZone,
  AdminZonesController.updateZone
);

router.delete(
  "/:zoneId",
  authorizeRoles("admin"),
  AdminZonesMiddleware.validateZoneId,
  AdminZonesController.deleteZone
);

module.exports = router;
