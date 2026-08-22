const DriverNotificationService = require("../services/driver-notification.service");

async function createPanicAlert(req, res, next) {
  try {
    res.status(201).json(await DriverNotificationService.createPanicAlert(req.user.id, req.body));
  } catch (error) {
    next(error);
  }
}

async function listNotifications(req, res, next) {
  try {
    res.json(await DriverNotificationService.listNotifications(req.query));
  } catch (error) {
    next(error);
  }
}

async function acknowledgeNotification(req, res, next) {
  try {
    res.json(
      await DriverNotificationService.acknowledgeNotification(req.params.notificationId, req.user.id)
    );
  } catch (error) {
    next(error);
  }
}

async function resolveNotification(req, res, next) {
  try {
    res.json(await DriverNotificationService.resolveNotification(req.params.notificationId, req.user.id));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPanicAlert,
  listNotifications,
  acknowledgeNotification,
  resolveNotification,
};
