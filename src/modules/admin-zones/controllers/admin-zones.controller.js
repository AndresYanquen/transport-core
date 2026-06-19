const AdminZonesService = require("../services/admin-zones.service");

async function listZones(_req, res, next) {
  try {
    const result = await AdminZonesService.listZones();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function createZone(req, res, next) {
  try {
    const result = await AdminZonesService.createZone(req.adminZonePayload);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateZone(req, res, next) {
  try {
    const result = await AdminZonesService.updateZone(req.adminZoneId, req.adminZonePayload);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function deleteZone(req, res, next) {
  try {
    await AdminZonesService.deleteZone(req.adminZoneId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createZone,
  deleteZone,
  listZones,
  updateZone,
};
