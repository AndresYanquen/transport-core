const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminUsersController = require("../controllers/admin-users.controller");
const AdminUsersMiddleware = require("../middleware/admin-users.middleware");

const router = Router();

router.get(
  "/drivers/approvals",
  authorizeRoles("admin"),
  AdminUsersMiddleware.validateListDriverApprovals,
  AdminUsersController.listDriverApprovals
);

router.patch(
  "/drivers/:driverId/approval",
  authorizeRoles("admin"),
  AdminUsersMiddleware.validateDriverApproval,
  AdminUsersController.updateDriverApproval
);

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
