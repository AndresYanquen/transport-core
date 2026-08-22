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
router.get("/favorites", authorizeRoles("admin", "operator"), AdminNavigationController.getFavorites);
router.put("/favorites", authorizeRoles("admin", "operator"), AdminNavigationController.updateFavorites);

module.exports = router;
