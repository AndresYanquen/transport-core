const ProfileImageService = require("../services/profile-image.service");

async function uploadProfileImage(req, res, next) {
  try {
    const result = await ProfileImageService.uploadProfileImage(req.user, req.file);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

async function deleteProfileImage(req, res, next) {
  try {
    const result = await ProfileImageService.deleteProfileImage(req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

const UserService = require("../services/user.service");

async function getProfile(req, res, next) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await UserService.getUser(req.user, req.params.userId || req.user.id));
  } catch (error) { next(error); }
}

async function updateProfile(req, res, next) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await UserService.updateUser(req.user, req.params.userId || req.user.id, req.body));
  } catch (error) { next(error); }
}

async function updateStatus(req, res, next) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await UserService.updateStatus(req.user, req.params.userId, req.body));
  } catch (error) { next(error); }
}

module.exports = { uploadProfileImage, deleteProfileImage, getProfile, updateProfile, updateStatus };
