const KapsoWhatsappService = require("../services/kapso-whatsapp.service");

async function receiveWebhook(req, res, next) {
  try {
    const result = await KapsoWhatsappService.processKapsoWebhookRequest({
      payload: req.body || {},
      headers: req.headers || {},
    });

    res.status(result.statusCode).json(result.body);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  receiveWebhook,
};
