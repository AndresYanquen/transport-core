/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex("config_settings")
    .insert([
      {
        key: "operational_city_name",
        value: "Tunja",
        description: "Default operating city name.",
      },
      {
        key: "operational_region_name",
        value: "Boyaca",
        description: "Default operating region, state, or department.",
      },
      {
        key: "operational_country_name",
        value: "Colombia",
        description: "Default operating country name.",
      },
      {
        key: "operational_country_code",
        value: "CO",
        description: "ISO 3166-1 alpha-2 country code used by operational defaults.",
      },
      {
        key: "operational_timezone",
        value: "America/Bogota",
        description: "IANA timezone used by operational views and reports.",
      },
      {
        key: "operational_default_locale",
        value: "es-CO",
        description: "BCP 47 locale used to format dates and currency.",
      },
      {
        key: "operational_default_currency",
        value: "COP",
        description: "ISO 4217 currency used when a ride request does not provide one.",
      },
      {
        key: "operational_default_phone_country",
        value: "CO",
        description: "Default country used to parse local phone numbers.",
      },
      {
        key: "operational_map_center_lat",
        value: "5.5353",
        description: "Default map center latitude.",
      },
      {
        key: "operational_map_center_lng",
        value: "-73.3678",
        description: "Default map center longitude.",
      },
      {
        key: "operational_map_default_zoom",
        value: "13",
        description: "Default map zoom level.",
      },
      {
        key: "operational_places_search_suffix",
        value: "Tunja, Boyaca, Colombia",
        description: "Address suffix appended to local place searches.",
      },
      {
        key: "operational_places_country_bias",
        value: "co",
        description: "Country component bias for Google Places searches.",
      },
      {
        key: "operational_places_search_radius_meters",
        value: "50000",
        description: "Radius in meters used to bias Google Places autocomplete.",
      },
    ])
    .onConflict("key")
    .ignore();
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex("config_settings")
    .whereIn("key", [
      "operational_city_name",
      "operational_region_name",
      "operational_country_name",
      "operational_country_code",
      "operational_timezone",
      "operational_default_locale",
      "operational_default_currency",
      "operational_default_phone_country",
      "operational_map_center_lat",
      "operational_map_center_lng",
      "operational_map_default_zoom",
      "operational_places_search_suffix",
      "operational_places_country_bias",
      "operational_places_search_radius_meters",
    ])
    .del();
};
