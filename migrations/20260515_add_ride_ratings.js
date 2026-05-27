/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("ride_ratings", (table) => {
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
      .uuid("rater_user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table
      .uuid("ratee_user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.integer("stars").notNullable();
    table.text("comment");
    table.jsonb("tags").defaultTo(knex.raw("'[]'::jsonb"));
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["ride_id", "rater_user_id"], "ride_ratings_ride_rater_unique");
    table.index(["ride_id"], "ride_ratings_ride_id_idx");
    table.index(["ratee_user_id"], "ride_ratings_ratee_user_id_idx");
  });

  await knex.schema.raw(`
    ALTER TABLE ride_ratings
    ADD CONSTRAINT ride_ratings_stars_check
    CHECK (stars >= 1 AND stars <= 5);
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw(`
    ALTER TABLE ride_ratings
    DROP CONSTRAINT IF EXISTS ride_ratings_stars_check;
  `);
  await knex.schema.dropTableIfExists("ride_ratings");
};

