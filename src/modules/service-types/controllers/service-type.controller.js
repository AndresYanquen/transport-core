const ServiceTypeService = require("../services/service-type.service");

async function listServiceTypes(req, res, next) {
  try {
    const result = await ServiceTypeService.listServiceTypes(
      req.user,
      req.serviceTypeQuery
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getServiceType(req, res, next) {
  try {
    const result = await ServiceTypeService.getServiceType(req.serviceTypeCode);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function createServiceType(req, res, next) {
  try {
    const result = await ServiceTypeService.createServiceType(req.serviceTypePayload);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateServiceType(req, res, next) {
  try {
    const result = await ServiceTypeService.updateServiceType(
      req.serviceTypeCode,
      req.serviceTypePayload
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function deleteServiceType(req, res, next) {
  try {
    await ServiceTypeService.deleteServiceType(req.serviceTypeCode);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listServiceTypes,
  getServiceType,
  createServiceType,
  updateServiceType,
  deleteServiceType,
};
