const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminUsersController = require("../controllers/admin-users.controller");
const AdminUsersMiddleware = require("../middleware/admin-users.middleware");

const router = Router();

router.get(
  "/",
  authorizeRoles("admin", "operator"),
  AdminUsersMiddleware.validateListUsers,
  AdminUsersController.listUsers
);

router.post(
  "/",
  authorizeRoles("admin", "operator"),
  AdminUsersMiddleware.validateCreateUser,
  AdminUsersController.createUser
);

module.exports = router;
