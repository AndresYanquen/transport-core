/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("rides", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("client_id")
      .notNullable()
      .references("user_id")
      .inTable("clients")
      .onDelete("RESTRICT");
    table
      .uuid("driver_id")
      .references("user_id")
      .inTable("drivers")
      .onDelete("SET NULL");
    table.string("status", 50).notNullable();
    table
      .string("service_type", 50)
      .notNullable()
      .defaultTo("standard");
    table.string("pickup_address", 255);
    table.string("dropoff_address", 255);
    table.jsonb("pickup_location").defaultTo(knex.raw("'{}'::jsonb"));
    table.jsonb("dropoff_location").defaultTo(knex.raw("'{}'::jsonb"));
    table.integer("estimated_distance_meters");
    table.integer("estimated_duration_seconds");
    table.integer("actual_distance_meters");
    table.integer("actual_duration_seconds");
    table.decimal("estimated_fare_amount", 10, 2);
    table.decimal("final_fare_amount", 10, 2);
    table.decimal("surge_multiplier", 5, 2).notNullable().defaultTo(1);
    table
      .string("currency", 3)
      .notNullable()
      .defaultTo("USD");
    table.string("payment_reference", 255).unique();
    table.jsonb("pricing_breakdown").defaultTo(knex.raw("'{}'::jsonb"));
    table.string("cancellation_reason", 255);
    table.timestamp("scheduled_at");
    table.timestamp("requested_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("accepted_at");
    table.timestamp("driver_arrived_at");
    table.timestamp("started_at");
    table.timestamp("completed_at");
    table.timestamp("canceled_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["client_id"], "rides_client_id_idx");
    table.index(["driver_id"], "rides_driver_id_idx");
    table.index(["status"], "rides_status_idx");
    table.index(["requested_at"], "rides_requested_at_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE rides
    ADD CONSTRAINT rides_status_check
    CHECK (
      status IN (
        'requested',
        'pending_driver',
        'driver_assigned',
        'driver_en_route',
        'driver_arrived',
        'in_progress',
        'completed',
        'canceled_by_client',
        'canceled_by_driver',
        'canceled_by_system',
        'no_show'
      )
    );
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_rides_updated_at
    BEFORE UPDATE ON rides
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);

  await knex.schema.createTable("ride_events", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("ride_id")
      .notNullable()
      .references("id")
      .inTable("rides")
      .onDelete("CASCADE");
    table
      .string("status", 50)
      .notNullable();
    table
      .string("actor_type", 50)
      .notNullable();
    table
      .uuid("actor_id")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.jsonb("payload").defaultTo(knex.raw("'{}'::jsonb"));
    table
      .timestamp("occurred_at")
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp("created_at")
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(["ride_id"], "ride_events_ride_id_idx");
    table.index(["status"], "ride_events_status_idx");
    table.index(["occurred_at"], "ride_events_occurred_at_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE ride_events
    ADD CONSTRAINT ride_events_status_check
    CHECK (
      status IN (
        'requested',
        'pending_driver',
        'driver_assigned',
        'driver_en_route',
        'driver_arrived',
        'in_progress',
        'completed',
        'canceled_by_client',
        'canceled_by_driver',
        'canceled_by_system',
        'no_show'
      )
    );
  `);

  await knex.schema.raw(`
    ALTER TABLE ride_events
    ADD CONSTRAINT ride_events_actor_type_check
    CHECK (
      actor_type IN ('client', 'driver', 'system', 'support')
    );
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    ALTER TABLE ride_events
    DROP CONSTRAINT IF EXISTS ride_events_actor_type_check;
  `);
  await knex.schema.raw(`
    ALTER TABLE ride_events
    DROP CONSTRAINT IF EXISTS ride_events_status_check;
  `);
  await knex.schema.dropTableIfExists("ride_events");

  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_rides_updated_at ON rides;
  `);
  await knex.schema.raw(`
    ALTER TABLE rides
    DROP CONSTRAINT IF EXISTS rides_status_check;
  `);
  await knex.schema.dropTableIfExists("rides");
};
