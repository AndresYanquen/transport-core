/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "postgis";');

  await knex.schema.createTable("users", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("email", 255).notNullable().unique();
    table.string("username", 50).unique();
    table.string("password_hash", 255).notNullable();
    table.string("first_name", 100);
    table.string("last_name", 100);
    table.string("phone_number", 30);
    table
      .string("role", 50)
      .notNullable()
      .defaultTo("client");
    table
      .string("status", 50)
      .notNullable()
      .defaultTo("active");
    table
      .boolean("email_verified")
      .notNullable()
      .defaultTo(false);
    table
      .boolean("phone_verified")
      .notNullable()
      .defaultTo(false);
    table.string("email_verification_token", 255);
    table.timestamp("email_verification_sent_at");
    table.string("phone_verification_token", 255);
    table.timestamp("phone_verification_sent_at");
    table.timestamp("last_login_at");
    table.jsonb("profile").defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("deleted_at");

    table.index(["role"], "users_role_idx");
    table.index(["status"], "users_status_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'client', 'driver'));
  `);

  await knex.schema.raw(`
    CREATE OR REPLACE FUNCTION update_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE 'plpgsql';
  `);

  await knex.schema.createTable("service_types", (table) => {
    table
      .uuid("id")
      .primary()
      .defaultTo(knex.raw("gen_random_uuid()"));
    table.string("code", 50).notNullable().unique();
    table.string("name", 100).notNullable();
    table.text("description");
    table.string("icon", 100);
    table.decimal("base_price", 10, 2).notNullable().defaultTo(0);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["is_active", "sort_order"], "service_types_active_sort_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE service_types
    ADD CONSTRAINT service_types_code_not_blank_check
    CHECK (length(trim(code)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE service_types
    ADD CONSTRAINT service_types_name_not_blank_check
    CHECK (length(trim(name)) > 0);
  `);

  await knex.schema.raw(`
    ALTER TABLE service_types
    ADD CONSTRAINT service_types_base_price_check
    CHECK (base_price >= 0);
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_service_types_updated_at
    BEFORE UPDATE ON service_types
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);

  await knex("service_types").insert([
    {
      code: "standard",
      name: "Standard",
      description: "Default everyday ride option.",
      icon: "car",
      base_price: 0,
      is_active: true,
      sort_order: 10,
    },
    {
      code: "premium",
      name: "Premium",
      description: "Higher comfort ride option.",
      icon: "gem",
      base_price: 7500,
      is_active: true,
      sort_order: 20,
    },
    {
      code: "pool",
      name: "Pool",
      description: "Shared ride option.",
      icon: "users",
      base_price: 0,
      is_active: true,
      sort_order: 30,
    },
  ]);

  await knex.schema.createTable("clients", (table) => {
    table
      .uuid("user_id")
      .primary()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("default_payment_method", 100);
    table.decimal("rating", 3, 2).defaultTo(0);
    table.specificType("home_location", "geography(Point, 4326)");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("drivers", (table) => {
    table
      .uuid("user_id")
      .primary()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("license_number", 100).notNullable().unique();
    table.string("vehicle_make", 100).notNullable();
    table.string("vehicle_model", 100).notNullable();
    table.integer("vehicle_year");
    table.string("vehicle_color", 50);
    table.string("vehicle_plate", 50).notNullable();
    table.string("vehicle_type", 50);
    table
      .string("service_type_code", 50)
      .notNullable()
      .defaultTo("standard")
      .references("code")
      .inTable("service_types")
      .onUpdate("CASCADE")
      .onDelete("RESTRICT");
    table.decimal("rating", 3, 2).defaultTo(0);
    table
      .string("status", 50)
      .notNullable()
      .defaultTo("offline");
    table.jsonb("documents").defaultTo(knex.raw("'{}'::jsonb"));
    table.specificType("current_location", "geography(Point, 4326)");
    table.double("heading_degrees");
    table.double("speed_kmh");
    table.timestamp("onboarded_at").defaultTo(knex.fn.now());
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(`
    CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);

  await knex.schema.raw(`
    CREATE TRIGGER set_drivers_updated_at
    BEFORE UPDATE ON drivers
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
  `);
  await knex.schema.raw(`
    CREATE INDEX clients_home_location_idx
    ON clients
    USING GIST (home_location);
  `);

  await knex.schema.raw(`
    CREATE INDEX drivers_current_location_idx
    ON drivers
    USING GIST (current_location);
  `);

  await knex.schema.raw(`
    CREATE INDEX drivers_service_type_code_idx
    ON drivers (service_type_code);
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    DROP INDEX IF EXISTS drivers_current_location_idx;
  `);
  await knex.schema.raw(`
    DROP INDEX IF EXISTS drivers_service_type_code_idx;
  `);
  await knex.schema.raw(`
    DROP INDEX IF EXISTS clients_home_location_idx;
  `);
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_drivers_updated_at ON drivers;
  `);
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_clients_updated_at ON clients;
  `);
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_users_updated_at ON users;
  `);
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_service_types_updated_at ON service_types;
  `);
  await knex.schema.raw(`
    DROP FUNCTION IF EXISTS update_timestamp;
  `);

  await knex.schema.dropTableIfExists("drivers");
  await knex.schema.dropTableIfExists("clients");
  await knex.schema.dropTableIfExists("service_types");
  await knex.schema.dropTableIfExists("users");
};
