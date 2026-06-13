const { Router } = require("express");

const SavedDestinationController = require("../controllers/saved-destination.controller");
const SavedDestinationMiddleware = require("../middleware/saved-destination.middleware");

const router = Router();

router.get(
  "/",
  SavedDestinationMiddleware.validateListQuery,
  SavedDestinationController.listSavedDestinations
);

router.post(
  "/",
  SavedDestinationMiddleware.validateCreateDestination,
  SavedDestinationController.createSavedDestination
);

router.get(
  "/:id",
  SavedDestinationMiddleware.validateDestinationId,
  SavedDestinationController.getSavedDestination
);

router.patch(
  "/:id",
  SavedDestinationMiddleware.validateDestinationId,
  SavedDestinationMiddleware.validateUpdateDestination,
  SavedDestinationController.updateSavedDestination
);

router.post(
  "/:id/used",
  SavedDestinationMiddleware.validateDestinationId,
  SavedDestinationController.markSavedDestinationUsed
);

router.delete(
  "/:id",
  SavedDestinationMiddleware.validateDestinationId,
  SavedDestinationController.deleteSavedDestination
);

module.exports = router;
