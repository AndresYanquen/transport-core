const ServiceTypeModel = require("../models/service-type.model");

function buildError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleDatabaseError(error) {
  if (error?.code === "23505") {
    throw buildError(409, "A service type with this code already exists.");
  }

  throw error;
}

async function listServiceTypes(user, options = {}) {
  const includeInactive =
    String(user?.role || "").toLowerCase() === "admin" && options.includeInactive;
  const serviceTypes = await ServiceTypeModel.list({ includeInactive });

  return { serviceTypes };
}

async function getServiceType(code) {
  const serviceType = await ServiceTypeModel.findByCode(code);

  if (!serviceType) {
    throw buildError(404, "Service type was not found.");
  }

  return { serviceType };
}

async function listActiveServiceTypeCodes() {
  return ServiceTypeModel.listActiveCodes();
}

async function createServiceType(payload) {
  try {
    const serviceType = await ServiceTypeModel.create(payload);
    return { serviceType };
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function updateServiceType(code, payload) {
  const serviceType = await ServiceTypeModel.updateByCode(code, payload);

  if (!serviceType) {
    throw buildError(404, "Service type was not found.");
  }

  return { serviceType };
}

async function deleteServiceType(code) {
  const deleted = await ServiceTypeModel.deleteByCode(code);

  if (!deleted) {
    throw buildError(404, "Service type was not found.");
  }

  return { deleted: true };
}

module.exports = {
  listServiceTypes,
  getServiceType,
  listActiveServiceTypeCodes,
  createServiceType,
  updateServiceType,
  deleteServiceType,
};
