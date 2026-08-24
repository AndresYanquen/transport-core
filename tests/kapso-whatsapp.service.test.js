const test = require("node:test");
const assert = require("node:assert/strict");

const KapsoWhatsappService = require("../src/modules/whatsapp/services/kapso-whatsapp.service");

const {
  extractMessage,
  isTaxiIntent,
  isConfirmation,
} = KapsoWhatsappService.__private;

test("extractMessage accepts common Kapso-style text payloads", () => {
  const message = extractMessage({
    from: "3001234567",
    message: {
      body: "Taxi",
    },
  });

  assert.equal(message.phone, "3001234567");
  assert.equal(message.text, "Taxi");
});

test("extractMessage accepts nested location payloads", () => {
  const message = extractMessage({
    contact: {
      phone: "+573001234567",
    },
    message: {
      location: {
        latitude: 5.535,
        longitude: -73.367,
        address: "Centro",
      },
    },
  });

  assert.equal(message.phone, "+573001234567");
  assert.deepEqual(message.location, {
    lat: 5.535,
    lng: -73.367,
    address: "Centro",
  });
});

test("intent helpers recognize MVP commands", () => {
  assert.equal(isTaxiIntent("quiero un taxi"), true);
  assert.equal(isTaxiIntent("hola"), false);
  assert.equal(isConfirmation("SI"), true);
  assert.equal(isConfirmation("no"), false);
});
