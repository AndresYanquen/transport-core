const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminNavigationController = require("../controllers/admin-navigation.controller");

const router = Router();

router.get("/menu", authorizeRoles("admin"), AdminNavigationController.getMenu);
router.get(
  "/operator-menu",
  authorizeRoles("admin", "operator"),
  AdminNavigationController.getOperatorMenu
);

module.exports = router;
