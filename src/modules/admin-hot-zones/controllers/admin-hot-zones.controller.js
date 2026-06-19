const AdminHotZonesService = require("../services/admin-hot-zones.service");

async function getSnapshot(req, res, next) {
  try {
    const result = await AdminHotZonesService.getSnapshot(req.query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSnapshot,
};
