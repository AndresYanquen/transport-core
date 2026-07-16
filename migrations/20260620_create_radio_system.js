exports.up = async function up(knex) {
  await knex.schema.createTable("radio_requests", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("driver_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("ride_id").references("id").inTable("rides").onDelete("SET NULL");
    table.uuid("handled_by_operator_id").references("id").inTable("users").onDelete("SET NULL");
    table.string("priority", 30).notNullable().defaultTo("normal");
    table.string("reason", 50).notNullable().defaultTo("general");
    table.string("status", 30).notNullable().defaultTo("pending");
    table.string("resolution_reason", 255);
    table.timestamp("expires_at").notNullable();
    table.timestamp("handled_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["status", "priority", "created_at"], "radio_requests_queue_idx");
  });
  await knex.raw(`
    CREATE UNIQUE INDEX radio_requests_one_pending_per_driver_idx
    ON radio_requests(driver_id) WHERE status = 'pending'
  `);

  await knex.schema.createTable("radio_sessions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("request_id").references("id").inTable("radio_requests").onDelete("SET NULL");
    table.uuid("operator_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table.uuid("driver_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table.uuid("ride_id").references("id").inTable("rides").onDelete("SET NULL");
    table.string("status", 40).notNullable().defaultTo("connecting");
    table.string("speaker", 20);
    table.boolean("operator_muted").notNullable().defaultTo(false);
    table.boolean("driver_muted").notNullable().defaultTo(false);
    table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("connected_at");
    table.timestamp("ended_at");
    table.timestamp("last_activity_at").notNullable().defaultTo(knex.fn.now());
    table.string("end_reason", 100);
    table.string("failure_reason", 255);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["status", "last_activity_at"], "radio_sessions_activity_idx");
  });
  await knex.raw(`
    CREATE UNIQUE INDEX radio_sessions_one_active_driver_idx
    ON radio_sessions(driver_id) WHERE status NOT IN ('ended', 'failed');
    CREATE UNIQUE INDEX radio_sessions_one_active_operator_idx
    ON radio_sessions(operator_id) WHERE status NOT IN ('ended', 'failed');
  `);

  await knex.schema.createTable("radio_session_events", (table) => {
    table.bigIncrements("id").primary();
    table.uuid("session_id").notNullable().references("id").inTable("radio_sessions").onDelete("CASCADE");
    table.uuid("actor_id").references("id").inTable("users").onDelete("SET NULL");
    table.string("actor_role", 30);
    table.string("event_type", 50).notNullable();
    table.jsonb("metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp("occurred_at").notNullable().defaultTo(knex.fn.now());
    table.index(["session_id", "occurred_at"], "radio_session_events_session_time_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("radio_session_events");
  await knex.schema.dropTableIfExists("radio_sessions");
  await knex.schema.dropTableIfExists("radio_requests");
};
