const { Router } = require("express");

const ServiceTypeController = require("../controllers/service-type.controller");
const ServiceTypeMiddleware = require("../middleware/service-type.middleware");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();

router.get(
  "/",
  authorizeRoles("client", "driver", "admin"),
  ServiceTypeMiddleware.validateListQuery,
  ServiceTypeController.listServiceTypes
);

router.post(
  "/",
  authorizeRoles("admin"),
  ServiceTypeMiddleware.validateCreateServiceType,
  ServiceTypeController.createServiceType
);

router.get(
  "/:code",
  authorizeRoles("client", "driver", "admin"),
  ServiceTypeMiddleware.validateCodeParam,
  ServiceTypeController.getServiceType
);

router.patch(
  "/:code",
  authorizeRoles("admin"),
  ServiceTypeMiddleware.validateCodeParam,
  ServiceTypeMiddleware.validateUpdateServiceType,
  ServiceTypeController.updateServiceType
);

router.delete(
  "/:code",
  authorizeRoles("admin"),
  ServiceTypeMiddleware.validateCodeParam,
  ServiceTypeController.deleteServiceType
);

module.exports = router;
