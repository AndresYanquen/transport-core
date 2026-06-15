/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasColor = await knex.schema.hasColumn("service_types", "color");
  if (!hasColor) {
    await knex.schema.alterTable("service_types", (table) => {
      table.string("color", 20);
    });
  }

  const colorsByCode = {
    standard: "#2563EB",
    premium: "#7C3AED",
    xl: "#0F766E",
    pool: "#F59E0B",
    deliver: "#16A34A",
    package_delivery: "#059669",
    food_delivery: "#EA580C",
    car_unstuck: "#DC2626",
    jump_start: "#CA8A04",
    tire_change: "#475569",
  };

  await Promise.all(
    Object.entries(colorsByCode).map(([code, color]) =>
      knex("service_types").where({ code }).whereNull("color").update({ color })
    )
  );
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasColor = await knex.schema.hasColumn("service_types", "color");
  if (hasColor) {
    await knex.schema.alterTable("service_types", (table) => {
      table.dropColumn("color");
    });
  }
};
