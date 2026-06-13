const SavedDestinationService = require("../services/saved-destination.service");

async function listSavedDestinations(req, res, next) {
  try {
    const result = await SavedDestinationService.listSavedDestinations(
      req.user,
      req.savedDestinationQuery
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getSavedDestination(req, res, next) {
  try {
    const result = await SavedDestinationService.getSavedDestination(
      req.user,
      req.savedDestinationId
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function createSavedDestination(req, res, next) {
  try {
    const result = await SavedDestinationService.createSavedDestination(
      req.user,
      req.savedDestinationPayload
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateSavedDestination(req, res, next) {
  try {
    const result = await SavedDestinationService.updateSavedDestination(
      req.user,
      req.savedDestinationId,
      req.savedDestinationPayload
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function markSavedDestinationUsed(req, res, next) {
  try {
    const result = await SavedDestinationService.markSavedDestinationUsed(
      req.user,
      req.savedDestinationId
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function deleteSavedDestination(req, res, next) {
  try {
    await SavedDestinationService.deleteSavedDestination(req.user, req.savedDestinationId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listSavedDestinations,
  getSavedDestination,
  createSavedDestination,
  updateSavedDestination,
  markSavedDestinationUsed,
  deleteSavedDestination,
};
