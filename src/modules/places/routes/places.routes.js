const { Router } = require("express");

const PlacesController = require("../controllers/places.controller");
const PlacesMiddleware = require("../middleware/places.middleware");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();

router.get(
  "/autocomplete",
  authorizeRoles("client", "driver", "admin", "operator"),
  PlacesMiddleware.autocomplete,
  PlacesController.autocomplete
);

router.get(
  "/details",
  authorizeRoles("client", "driver", "admin", "operator"),
  PlacesMiddleware.details,
  PlacesController.details
);

router.get(
  "/geocode",
  authorizeRoles("client", "driver", "admin", "operator"),
  PlacesMiddleware.geocode,
  PlacesController.geocode
);

router.get(
  "/reverse-geocode",
  authorizeRoles("client", "driver", "admin", "operator"),
  PlacesMiddleware.reverseGeocode,
  PlacesController.reverseGeocode
);

module.exports = router;
