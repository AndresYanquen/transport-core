const { Router } = require("express");
const PublicRideTrackingController = require("../controllers/public-ride-tracking.controller");

const router = Router();

router.get("/:trackingToken", PublicRideTrackingController.getPublicRideTracking);

module.exports = router;
