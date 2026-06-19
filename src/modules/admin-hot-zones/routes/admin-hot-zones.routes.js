const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminHotZonesController = require("../controllers/admin-hot-zones.controller");

const router = Router();

router.get("/", authorizeRoles("admin", "operator"), AdminHotZonesController.getSnapshot);

module.exports = router;
