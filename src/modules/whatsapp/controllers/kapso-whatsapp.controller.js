const KapsoWhatsappService = require("../services/kapso-whatsapp.service");

async function receiveWebhook(req, res, next) {
  try {
    const result = await KapsoWhatsappService.handleKapsoWebhook(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  receiveWebhook,
};
