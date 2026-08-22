const AdminUsersService = require("../services/admin-users.service");

async function createUser(req, res, next) {
  try {
    const payload =
      req.user?.role === "operator"
        ? { ...req.adminUserPayload, role: "client", status: req.adminUserPayload.status || "active" }
        : req.adminUserPayload;
    const result = await AdminUsersService.createUser(payload);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    const query =
      req.user?.role === "operator"
        ? { ...req.adminUsersQuery, role: "client" }
        : req.adminUsersQuery;
    const result = await AdminUsersService.listUsers(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function listDriverApprovals(req, res, next) {
  try {
    const result = await AdminUsersService.listDriverApprovals(req.adminDriverApprovalsQuery);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function updateDriverApproval(req, res, next) {
  try {
    const result = await AdminUsersService.updateDriverApproval(
      req.adminDriverId,
      req.adminDriverApprovalPayload,
      req.user.id
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createUser,
  listDriverApprovals,
  listUsers,
  updateDriverApproval,
};
