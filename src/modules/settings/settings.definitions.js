const settingDefinitions = {
  client_driver_search_radius_meters: {
    type: "integer",
    min: 100,
    max: 100000,
    description:
      "Distance in meters used when searching available drivers near a client pickup location.",
  },
  driver_request_search_radius_meters: {
    type: "integer",
    min: 100,
    max: 100000,
    description:
      "Distance in meters used when searching pending ride requests near a driver.",
  },
  operational_city_name: {
    type: "string",
    minLength: 1,
    maxLength: 120,
    description: "Default operating city name.",
  },
  operational_region_name: {
    type: "string",
    minLength: 1,
    maxLength: 120,
    description: "Default operating region, state, or department.",
  },
  operational_country_name: {
    type: "string",
    minLength: 1,
    maxLength: 120,
    description: "Default operating country name.",
  },
  operational_country_code: {
    type: "string",
    pattern: /^[A-Z]{2}$/,
    transform: (value) => value.toUpperCase(),
    description: "ISO 3166-1 alpha-2 country code used by operational defaults.",
  },
  operational_timezone: {
    type: "string",
    minLength: 1,
    maxLength: 80,
    description: "IANA timezone used by operational views and reports.",
  },
  operational_default_locale: {
    type: "string",
    pattern: /^[a-z]{2,3}(-[A-Z]{2})?$/,
    description: "BCP 47 locale used to format dates and currency.",
  },
  operational_default_currency: {
    type: "string",
    pattern: /^[A-Z]{3}$/,
    transform: (value) => value.toUpperCase(),
    description: "ISO 4217 currency used when a ride request does not provide one.",
  },
  operational_default_phone_country: {
    type: "string",
    pattern: /^[A-Z]{2}$/,
    transform: (value) => value.toUpperCase(),
    description: "Default country used to parse local phone numbers.",
  },
  operational_map_center_lat: {
    type: "number",
    min: -90,
    max: 90,
    description: "Default map center latitude.",
  },
  operational_map_center_lng: {
    type: "number",
    min: -180,
    max: 180,
    description: "Default map center longitude.",
  },
  operational_map_default_zoom: {
    type: "integer",
    min: 1,
    max: 20,
    description: "Default map zoom level.",
  },
  operational_places_search_suffix: {
    type: "string",
    minLength: 1,
    maxLength: 240,
    description: "Address suffix appended to local place searches.",
  },
  operational_places_country_bias: {
    type: "string",
    pattern: /^[a-z]{2}$/,
    transform: (value) => value.toLowerCase(),
    description: "Country component bias for Google Places searches.",
  },
  operational_places_search_radius_meters: {
    type: "integer",
    min: 1000,
    max: 100000,
    description: "Radius in meters used to bias Google Places autocomplete.",
  },
  driver_creation_approval_policy: {
    type: "string",
    allowedValues: ["pending", "auto_approved"],
    description: "Controls whether newly created drivers require approval or are approved immediately.",
  },
};

const operationalSettingKeys = Object.keys(settingDefinitions).filter((key) =>
  key.startsWith("operational_")
);

function validateSettingValue(key, rawValue) {
  const definition = settingDefinitions[key];
  if (!definition) {
    const error = new Error(`Unsupported setting "${key}".`);
    error.status = 400;
    throw error;
  }

  const stringValue = String(rawValue ?? "").trim();
  const transformed = definition.transform ? definition.transform(stringValue) : stringValue;

  if (definition.type === "string") {
    if (definition.allowedValues && !definition.allowedValues.includes(transformed)) {
      throwSettingError(key, `must be one of: ${definition.allowedValues.join(", ")}.`);
    }
    if (definition.minLength && transformed.length < definition.minLength) {
      throwSettingError(key, `must be at least ${definition.minLength} characters.`);
    }
    if (definition.maxLength && transformed.length > definition.maxLength) {
      throwSettingError(key, `must be at most ${definition.maxLength} characters.`);
    }
    if (definition.pattern && !definition.pattern.test(transformed)) {
      throwSettingError(key, "has an invalid format.");
    }
    return transformed;
  }

  const value = Number(transformed);
  if (!Number.isFinite(value)) {
    throwSettingError(key, "must be a number.");
  }
  if (definition.type === "integer" && !Number.isInteger(value)) {
    throwSettingError(key, "must be an integer.");
  }
  if (definition.min !== undefined && value < definition.min) {
    throwSettingError(key, `must be greater than or equal to ${definition.min}.`);
  }
  if (definition.max !== undefined && value > definition.max) {
    throwSettingError(key, `must be less than or equal to ${definition.max}.`);
  }
  return String(value);
}

function throwSettingError(key, message) {
  const error = new Error(`${key} ${message}`);
  error.status = 400;
  throw error;
}

module.exports = {
  operationalSettingKeys,
  settingDefinitions,
  validateSettingValue,
};
