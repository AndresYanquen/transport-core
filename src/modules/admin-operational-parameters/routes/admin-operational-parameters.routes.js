const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminOperationalParametersController = require("../controllers/admin-operational-parameters.controller");
const AdminOperationalParametersMiddleware = require("../middleware/admin-operational-parameters.middleware");

const router = Router();

router.get(
  "/",
  authorizeRoles("admin"),
  AdminOperationalParametersController.listParameters
);

router.patch(
  "/",
  authorizeRoles("admin"),
  AdminOperationalParametersMiddleware.validateUpdate,
  AdminOperationalParametersController.updateParameters
);

module.exports = router;
