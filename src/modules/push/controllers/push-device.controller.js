const Service = require("../services/push-device.service");
const Model = require("../models/push-device.model");
const Presence = require("../services/push-presence.service");
function handler(action) {
  return async (req, res, next) => {
    try { await action(req, res); }
    catch (error) {
      // SQL/provider errors may contain token values; never pass them to the global logger.
      next(Object.assign(new Error(error.status ? error.message : "Push device operation unavailable."), { status: error.status || 503 }));
    }
  };
}
module.exports = {
  presence: handler(async (req, res) => res.json(await Presence.reportVisibility(req.auth, req.body))),
  presented: handler(async (req, res) => res.json(await Presence.acknowledgePresentation(req.auth, req.body))),
  register: handler(async (req, res) => res.json({ device: await Service.register(req.auth, req.body) })),
  unregister: handler(async (req, res) => { await Service.unregister(req.auth, req.body); res.status(204).end(); }),
  list: handler(async (req, res) => res.json({ devices: await Model.list(req.auth.userId) })),
};
