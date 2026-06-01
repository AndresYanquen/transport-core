const AdminSimulationService = require("../services/admin-simulation.service");

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${fieldName} must be a valid ISO date.`);
    error.status = 400;
    throw error;
  }

  return date;
}

async function getState(req, res, next) {
  try {
    const limit = Number(req.query.limit ?? 200);
    const safeLimit = Number.isFinite(limit) ? Math.max(50, Math.min(1000, limit)) : 200;
    const from = parseOptionalDate(req.query.from, "from");
    const to = parseOptionalDate(req.query.to, "to");

    if (from && to && from.getTime() > to.getTime()) {
      const error = new Error("from must be before to.");
      error.status = 400;
      throw error;
    }

    const state = await AdminSimulationService.getSimulationState({
      limit: safeLimit,
      from,
      to,
    });

    res.status(200).json(state);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getState,
};
