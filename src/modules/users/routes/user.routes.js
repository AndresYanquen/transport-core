const { Router } = require("express");
const multer = require("multer");

const Controller = require("../controllers/user.controller");
const ProfileImageService = require("../services/profile-image.service");
const { authorizeRoles } = require("../../auth/middleware/authentication.middleware");

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ProfileImageService.MAX_PROFILE_IMAGE_BYTES,
    files: 1,
  },
});

router.post(
  "/me/profile-image",
  authorizeRoles("client", "driver"),
  upload.single("profileImage"),
  Controller.uploadProfileImage
);
router.delete(
  "/me/profile-image",
  authorizeRoles("client", "driver"),
  Controller.deleteProfileImage
);

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "profileImage must be 5 MB or smaller."
          : error.message,
    });
  }

  return next(error);
});

module.exports = router;
