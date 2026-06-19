const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminDriversMapController = require("../controllers/admin-drivers-map.controller");

const router = Router();

router.get("/", authorizeRoles("admin"), AdminDriversMapController.getDriversMapSnapshot);

module.exports = router;
