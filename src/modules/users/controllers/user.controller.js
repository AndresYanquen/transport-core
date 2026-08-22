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

module.exports = {
  uploadProfileImage,
  deleteProfileImage,
};
