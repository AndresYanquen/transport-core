const { Router } = require("express");
const KapsoWhatsappController = require("../controllers/kapso-whatsapp.controller");

const router = Router();

router.post("/kapso/whatsapp", KapsoWhatsappController.receiveWebhook);

module.exports = router;
