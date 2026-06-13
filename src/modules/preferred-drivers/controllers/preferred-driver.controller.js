const PreferredDriverService = require("../services/preferred-driver.service");

async function listPreferredDrivers(req, res, next) {
  try {
    const result = await PreferredDriverService.listPreferredDrivers(
      req.user,
      req.preferredDriverQuery
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function addPreferredDriver(req, res, next) {
  try {
    const result = await PreferredDriverService.addPreferredDriver(
      req.user,
      req.preferredDriverId
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function getPreferredDriver(req, res, next) {
  try {
    const result = await PreferredDriverService.getPreferredDriver(
      req.user,
      req.preferredDriverId
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function removePreferredDriver(req, res, next) {
  try {
    await PreferredDriverService.removePreferredDriver(req.user, req.preferredDriverId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listPreferredDrivers,
  addPreferredDriver,
  getPreferredDriver,
  removePreferredDriver,
};
