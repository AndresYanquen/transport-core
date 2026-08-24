const { Router } = require("express");
const KapsoWhatsappController = require("../controllers/kapso-whatsapp.controller");

const router = Router();

function verifyKapsoSecret(req, res, next) {
  const configuredSecret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return next();
  }

  const providedSecret =
    req.get("x-kapso-webhook-secret") ||
    req.get("x-webhook-secret") ||
    req.query.secret;

  if (providedSecret !== configuredSecret) {
    return res.status(401).json({ message: "Invalid Kapso webhook secret." });
  }

  next();
}

router.post("/kapso/whatsapp", verifyKapsoSecret, KapsoWhatsappController.receiveWebhook);

module.exports = router;
