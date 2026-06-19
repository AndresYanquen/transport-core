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

module.exports = {
  getMenu,
  getOperatorMenu,
};
