/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "postgis";');

  const hasPickupPoint = await knex.schema.hasColumn("rides", "pickup_point");
  const hasPickupLocation = await knex.schema.hasColumn("rides", "pickup_location");

  if (!hasPickupPoint) {
    await knex.schema.alterTable("rides", (table) => {
      table.specificType("pickup_point", "geography(Point, 4326)");
    });
  }

  if (!await knex.schema.hasColumn("rides", "dropoff_point")) {
    await knex.schema.alterTable("rides", (table) => {
      table.specificType("dropoff_point", "geography(Point, 4326)");
    });
  }

  if (hasPickupLocation) {
    await knex.schema.raw(`
      UPDATE rides
      SET pickup_point = CASE
          WHEN pickup_location ->> 'lat' IS NOT NULL
            AND pickup_location ->> 'lng' IS NOT NULL
            AND (pickup_location ->> 'lat')::double precision BETWEEN -90 AND 90
            AND (pickup_location ->> 'lng')::double precision BETWEEN -180 AND 180
          THEN ST_SetSRID(
            ST_MakePoint(
              (pickup_location ->> 'lng')::double precision,
              (pickup_location ->> 'lat')::double precision
            ),
            4326
          )::geography
          ELSE NULL
        END,
        dropoff_point = CASE
          WHEN dropoff_location ->> 'lat' IS NOT NULL
            AND dropoff_location ->> 'lng' IS NOT NULL
            AND (dropoff_location ->> 'lat')::double precision BETWEEN -90 AND 90
            AND (dropoff_location ->> 'lng')::double precision BETWEEN -180 AND 180
          THEN ST_SetSRID(
            ST_MakePoint(
              (dropoff_location ->> 'lng')::double precision,
              (dropoff_location ->> 'lat')::double precision
            ),
            4326
          )::geography
          ELSE NULL
        END
    `);

    await knex.schema.alterTable("rides", (table) => {
      table.dropColumn("pickup_location");
      table.dropColumn("dropoff_location");
    });
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS rides_pickup_point_idx
    ON rides USING GIST (pickup_point);
  `);
  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS rides_dropoff_point_idx
    ON rides USING GIST (dropoff_point);
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasPickupLocation = await knex.schema.hasColumn("rides", "pickup_location");

  if (!hasPickupLocation) {
    await knex.schema.alterTable("rides", (table) => {
      table.jsonb("pickup_location").defaultTo(knex.raw("'{}'::jsonb"));
      table.jsonb("dropoff_location").defaultTo(knex.raw("'{}'::jsonb"));
    });

    await knex.schema.raw(`
      UPDATE rides
      SET pickup_location = COALESCE(ST_AsGeoJSON(pickup_point)::jsonb, '{}'::jsonb),
          dropoff_location = COALESCE(ST_AsGeoJSON(dropoff_point)::jsonb, '{}'::jsonb)
    `);
  }

  await knex.schema.raw(`
    DROP INDEX IF EXISTS rides_dropoff_point_idx;
  `);
  await knex.schema.raw(`
    DROP INDEX IF EXISTS rides_pickup_point_idx;
  `);

  await knex.schema.alterTable("rides", (table) => {
    table.dropColumn("pickup_point");
    table.dropColumn("dropoff_point");
  });
};
