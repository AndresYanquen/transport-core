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

router.patch(
  "/drivers/:driverId/approvalRequest",
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

const UserController = require("../../users/controllers/user.controller");
const { validateUserId } = require("../../users/middleware/user.middleware");
router.get("/:userId", authorizeRoles("admin", "operator"), validateUserId, UserController.getProfile);
router.patch("/:userId", authorizeRoles("admin"), validateUserId, UserController.updateProfile);
router.patch("/:userId/status", authorizeRoles("admin"), validateUserId, UserController.updateStatus);
module.exports = router;
