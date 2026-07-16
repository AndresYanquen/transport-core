const { parsePhoneNumberFromString } = require("libphonenumber-js");

const DEFAULT_PHONE_COUNTRY = process.env.DEFAULT_PHONE_COUNTRY || "CO";

function normalizePhoneNumber(input, defaultCountry = DEFAULT_PHONE_COUNTRY) {
  const rawValue = String(input || "").trim();
  if (!rawValue) return null;

  const phone = parsePhoneNumberFromString(rawValue, defaultCountry);
  if (!phone || !phone.isValid()) {
    const error = new Error("phoneNumber must be a valid phone number.");
    error.status = 400;
    throw error;
  }

  return phone.number;
}

module.exports = {
  DEFAULT_PHONE_COUNTRY,
  normalizePhoneNumber,
};
