const Identity = require("../services/identity-change.service");
async function authorizePhoneChange(req, res, next) {
  try {
    req.credentialVersion = await Identity.authorizePhoneChange(req.user, req.body || {}, req.auth);
    next();
  } catch (error) { next(error); }
}
module.exports = { authorizePhoneChange };
