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

async function listServiceTypes(req, res, next) {
  try {
    const result = await DriverService.listServiceTypes(req.params.driverId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function replaceServiceTypes(req, res, next) {
  try {
    const result = await DriverService.replaceServiceTypes(
      req.params.driverId,
      req.body.serviceTypes
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  updateLocation,
  updateStatus,
  listServiceTypes,
  replaceServiceTypes,
};
