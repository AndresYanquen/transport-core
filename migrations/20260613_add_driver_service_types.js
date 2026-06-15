/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasCategory = await knex.schema.hasColumn("service_types", "category");
  if (!hasCategory) {
    await knex.schema.alterTable("service_types", (table) => {
      table.string("category", 50).notNullable().defaultTo("ride");
    });
  }

  await knex("service_types")
    .insert([
      {
        code: "xl",
        category: "ride",
        name: "XL",
        description: "Larger vehicle ride option.",
        icon: "bus",
        base_price: 10000,
        is_active: true,
        sort_order: 25,
      },
      {
        code: "package_delivery",
        category: "delivery",
        name: "Package Delivery",
        description: "Point-to-point package delivery.",
        icon: "package",
        base_price: 5000,
        is_active: true,
        sort_order: 110,
      },
      {
        code: "food_delivery",
        category: "delivery",
        name: "Food Delivery",
        description: "Food pickup and delivery.",
        icon: "utensils",
        base_price: 4000,
        is_active: true,
        sort_order: 120,
      },
      {
        code: "car_unstuck",
        category: "roadside",
        name: "Car Unstuck",
        description: "Help getting a stuck vehicle moving again.",
        icon: "wrench",
        base_price: 20000,
        is_active: true,
        sort_order: 210,
      },
      {
        code: "jump_start",
        category: "roadside",
        name: "Jump Start",
        description: "Battery jump-start assistance.",
        icon: "battery-charging",
        base_price: 15000,
        is_active: true,
        sort_order: 220,
      },
      {
        code: "tire_change",
        category: "roadside",
        name: "Tire Change",
        description: "Flat tire replacement assistance.",
        icon: "disc",
        base_price: 18000,
        is_active: true,
        sort_order: 230,
      },
    ])
    .onConflict("code")
    .merge(["category", "name", "description", "icon", "base_price", "is_active", "sort_order"]);

  const hasDriverServiceTypes = await knex.schema.hasTable("driver_service_types");
  if (!hasDriverServiceTypes) {
    await knex.schema.createTable("driver_service_types", (table) => {
      table
        .uuid("driver_id")
        .notNullable()
        .references("user_id")
        .inTable("drivers")
        .onDelete("CASCADE");
      table
        .string("service_type_code", 50)
        .notNullable()
        .references("code")
        .inTable("service_types")
        .onUpdate("CASCADE")
        .onDelete("RESTRICT");
      table.boolean("is_active").notNullable().defaultTo(true);
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

      table.primary(["driver_id", "service_type_code"]);
      table.index(["service_type_code", "is_active"], "driver_service_types_service_active_idx");
    });

    await knex.schema.raw(`
      CREATE TRIGGER set_driver_service_types_updated_at
      BEFORE UPDATE ON driver_service_types
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();
    `);
  }

  const hasDriverServiceTypeCode = await knex.schema.hasColumn("drivers", "service_type_code");
  if (hasDriverServiceTypeCode) {
    await knex.raw(`
      INSERT INTO driver_service_types (driver_id, service_type_code, is_active)
      SELECT user_id, service_type_code, true
      FROM drivers
      WHERE service_type_code IS NOT NULL
      ON CONFLICT (driver_id, service_type_code)
      DO UPDATE SET is_active = true, updated_at = NOW();
    `);

    await knex.schema.raw("DROP INDEX IF EXISTS drivers_service_type_code_idx;");
    await knex.schema.raw(`
      ALTER TABLE drivers
      DROP CONSTRAINT IF EXISTS drivers_service_type_code_foreign;
    `);
    await knex.schema.alterTable("drivers", (table) => {
      table.dropColumn("service_type_code");
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasDriverServiceTypeCode = await knex.schema.hasColumn("drivers", "service_type_code");
  if (!hasDriverServiceTypeCode) {
    await knex.schema.alterTable("drivers", (table) => {
      table.string("service_type_code", 50).notNullable().defaultTo("standard");
    });

    await knex.raw(`
      UPDATE drivers d
      SET service_type_code = COALESCE(
        (
          SELECT dst.service_type_code
          FROM driver_service_types dst
          WHERE dst.driver_id = d.user_id
            AND dst.is_active = true
          ORDER BY dst.service_type_code = 'standard' DESC, dst.service_type_code ASC
          LIMIT 1
        ),
        'standard'
      );
    `);
  }

  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS set_driver_service_types_updated_at
    ON driver_service_types;
  `);
  await knex.schema.dropTableIfExists("driver_service_types");
};
