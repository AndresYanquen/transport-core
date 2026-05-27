const AdminSimulationService = require("../services/admin-simulation.service");

async function getState(req, res, next) {
  try {
    const limit = Number(req.query.limit ?? 200);
    const safeLimit = Number.isFinite(limit) ? Math.max(50, Math.min(1000, limit)) : 200;

    const state = await AdminSimulationService.getSimulationState({
      limit: safeLimit,
    });

    res.status(200).json(state);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getState,
};

