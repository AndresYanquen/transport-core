const Identity = require("../services/identity-change.service");
function handler(operation) {
  return async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await Identity[operation](req.user, req.body || {}, req.auth));
    } catch (error) { next(error); }
  };
}
module.exports = {
  requestEmailProof: handler("requestEmailProof"),
  verifyEmailProof: handler("verifyEmailProof"),
  requestEmailChange: handler("requestEmailChange"),
  verifyEmailChange: handler("verifyEmailChange"),
  changePassword: handler("changePassword"),
};
