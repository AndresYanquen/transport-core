const PlacesService = require("../services/places.service");

async function autocomplete(req, res, next) {
  try {
    const result = await PlacesService.autocomplete(req.placesQuery);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function details(req, res, next) {
  try {
    const result = await PlacesService.details(req.placesQuery);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function reverseGeocode(req, res, next) {
  try {
    const result = await PlacesService.reverseGeocode(req.placesQuery);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  autocomplete,
  details,
  reverseGeocode,
};
