const SavedDestinationModel = require("../models/saved-destination.model");

function buildNotFoundError() {
  const error = new Error("Saved destination was not found.");
  error.status = 404;
  return error;
}

function buildConflictError() {
  const error = new Error("A saved destination already exists for this place.");
  error.status = 409;
  return error;
}

function handleDatabaseError(error) {
  if (error?.code === "23505") {
    throw buildConflictError();
  }

  throw error;
}

async function listSavedDestinations(user, options) {
  const destinations = await SavedDestinationModel.listByUserId(user.id, options);

  return { destinations };
}

async function getSavedDestination(user, destinationId) {
  const destination = await SavedDestinationModel.findByIdForUser(user.id, destinationId);

  if (!destination) {
    throw buildNotFoundError();
  }

  return { destination };
}

async function createSavedDestination(user, payload) {
  try {
    const destination = await SavedDestinationModel.createForUser(user.id, payload);
    return { destination };
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function updateSavedDestination(user, destinationId, payload) {
  try {
    const destination = await SavedDestinationModel.updateForUser(
      user.id,
      destinationId,
      payload
    );

    if (!destination) {
      throw buildNotFoundError();
    }

    return { destination };
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function markSavedDestinationUsed(user, destinationId) {
  const destination = await SavedDestinationModel.markUsedForUser(user.id, destinationId);

  if (!destination) {
    throw buildNotFoundError();
  }

  return { destination };
}

async function deleteSavedDestination(user, destinationId) {
  const deleted = await SavedDestinationModel.softDeleteForUser(user.id, destinationId);

  if (!deleted) {
    throw buildNotFoundError();
  }

  return { deleted: true };
}

module.exports = {
  listSavedDestinations,
  getSavedDestination,
  createSavedDestination,
  updateSavedDestination,
  markSavedDestinationUsed,
  deleteSavedDestination,
};
