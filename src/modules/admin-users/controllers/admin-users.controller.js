const AdminUsersService = require("../services/admin-users.service");

async function createUser(req, res, next) {
  try {
    const result = await AdminUsersService.createUser(req.adminUserPayload);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const result = await AdminUsersService.listUsers(req.adminUsersQuery);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createUser,
  listUsers,
};
