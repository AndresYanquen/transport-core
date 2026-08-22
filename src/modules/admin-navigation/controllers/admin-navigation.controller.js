const AdminNavigationService = require("../services/admin-navigation.service");

async function getMenu(req, res, next) {
  try {
    const result = await AdminNavigationService.getMenuForUser(req.user, {
      rootPrefix: "admin",
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getOperatorMenu(req, res, next) {
  try {
    const result = await AdminNavigationService.getMenuForUser(req.user, {
      rootPrefix: "operator",
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function getFavorites(req, res, next) {
  try {
    const result = await AdminNavigationService.getFavoritesForUser(req.user, {
      rootPrefix: req.query.rootPrefix || (req.user.role === "operator" ? "operator" : "admin"),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateFavorites(req, res, next) {
  try {
    const result = await AdminNavigationService.updateFavoritesForUser(req.user, {
      rootPrefix: req.body?.rootPrefix || (req.user.role === "operator" ? "operator" : "admin"),
      favoriteCodes: Array.isArray(req.body?.favoriteCodes) ? req.body.favoriteCodes : [],
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getFavorites,
  getMenu,
  getOperatorMenu,
  updateFavorites,
};
