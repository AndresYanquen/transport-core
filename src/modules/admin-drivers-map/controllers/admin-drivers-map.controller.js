const AdminDriversMapService = require("../services/admin-drivers-map.service");

async function getDriversMapSnapshot(_req, res, next) {
  try {
    const result = await AdminDriversMapService.getDriversMapSnapshot();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDriversMapSnapshot,
};
