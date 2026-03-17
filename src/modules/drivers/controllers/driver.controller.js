const DriverService = require("../services/driver.service");

async function updateLocation(req, res, next) {
  try {
    const driverId = req.params.driverId;
    const { currentLocationWkt, heading, speedKmh } = req.body;

    const result = await DriverService.updateLocation(driverId, {
      currentLocationWkt,
      heading,
      speedKmh,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const driverId = req.params.driverId;
    const { status } = req.body;

    const driver = await DriverService.updateStatus(driverId, status);
    res.json(driver);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  updateLocation,
  updateStatus,
};
