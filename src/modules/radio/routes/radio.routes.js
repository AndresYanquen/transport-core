const { Router } = require("express");
const Controller = require("../controllers/radio.controller");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();
router.post("/requests", authorizeRoles("driver"), Controller.createRequest);
router.get("/requests/mine", authorizeRoles("driver"), Controller.myRequest);
router.post("/requests/:requestId/cancel", authorizeRoles("driver"), Controller.cancelRequest);
router.get("/requests", authorizeRoles("operator", "admin"), Controller.listRequests);
router.post("/requests/:requestId/accept", authorizeRoles("operator"), Controller.acceptRequest);
router.post("/requests/:requestId/reject", authorizeRoles("operator"), Controller.rejectRequest);
router.post("/sessions", authorizeRoles("operator"), Controller.createSession);
router.get("/sessions/:sessionId", authorizeRoles("driver", "operator", "admin"), Controller.getSession);
router.get("/ice-config", authorizeRoles("driver", "operator"), Controller.iceConfig);
module.exports = router;
