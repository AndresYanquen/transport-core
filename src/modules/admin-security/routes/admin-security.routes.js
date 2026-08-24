const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminSecurityController = require("../controllers/admin-security.controller");

const router = Router();

router.get("/roles", authorizeRoles("admin"), AdminSecurityController.listRoles);
router.get("/permissions", authorizeRoles("admin"), AdminSecurityController.listPermissions);
router.get("/audit", authorizeRoles("admin"), AdminSecurityController.listAuditEvents);

module.exports = router;
