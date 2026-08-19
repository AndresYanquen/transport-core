const RideService = require("../services/ride.service");

async function getPublicRideTracking(req, res, next) {
  try {
    const result = await RideService.getPublicRideTracking(req.params.trackingToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPublicRideTracking,
};
