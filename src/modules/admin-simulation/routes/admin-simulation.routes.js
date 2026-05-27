const { Router } = require("express");

const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");
const AdminSimulationController = require("../controllers/admin-simulation.controller");
const { env } = require("../../../config");

const router = Router();

const isProd = String(env.nodeEnv || "").toLowerCase() === "production";
const maybeAuthorizeAdmin = isProd ? authorizeRoles("admin") : (_req, _res, next) => next();

router.get(
  "/state",
  maybeAuthorizeAdmin,
  AdminSimulationController.getState
);

module.exports = router;
