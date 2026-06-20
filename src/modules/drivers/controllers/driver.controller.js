const DriverService = require("../services/driver.service");
const DriverHotZonesService = require("../services/driver-hot-zones.service");

async function getHotZones(req, res, next) {
  try {
    const result = await DriverHotZonesService.getSnapshot(req.user.id, req.query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listHotZoneRequests(req, res, next) {
  try {
    const result = await DriverHotZonesService.listZoneRequests(
      req.user.id,
      req.params.zoneId,
      req.query
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateLocation(req, res, next) {
  try {
    const driverId = req.params.driverId;
    const { currentLocationWkt, heading, speedKmh, hasLocation } = req.body;

    const result = await DriverService.updateLocation(driverId, {
      currentLocationWkt,
      heading,
      speedKmh,
      hasLocation,
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
  getHotZones,
  listHotZoneRequests,
  updateLocation,
  updateStatus,
  listServiceTypes,
  replaceServiceTypes,
};
