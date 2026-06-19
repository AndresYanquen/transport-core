const AdminOperationalParametersService = require("../services/admin-operational-parameters.service");

async function listParameters(_req, res, next) {
  try {
    const result = await AdminOperationalParametersService.listParameters();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateParameters(req, res, next) {
  try {
    const result = await AdminOperationalParametersService.updateParameters(
      req.operationalParametersPayload
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listParameters,
  updateParameters,
};
