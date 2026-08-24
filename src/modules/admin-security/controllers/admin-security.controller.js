const AdminSecurityService = require("../services/admin-security.service");

async function listRoles(_req, res, next) {
  try {
    res.status(200).json(await AdminSecurityService.listRoles());
  } catch (error) {
    next(error);
  }
}

async function listPermissions(_req, res, next) {
  try {
    res.status(200).json(await AdminSecurityService.listPermissions());
  } catch (error) {
    next(error);
  }
}

async function listAuditEvents(req, res, next) {
  try {
    res.status(200).json(await AdminSecurityService.listAuditEvents(req.query));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listAuditEvents,
  listPermissions,
  listRoles,
};
