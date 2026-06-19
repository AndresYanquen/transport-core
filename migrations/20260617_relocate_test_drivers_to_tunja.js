exports.up = async function up(knex) {
  await knex.raw(`
    WITH test_drivers AS (
      SELECT
        d.user_id,
        ROW_NUMBER() OVER (ORDER BY u.email) AS rn
      FROM drivers d
      JOIN users u ON u.id = d.user_id
      WHERE (
          u.email ~* '^driver[0-9]+@test\\.com$'
          OR u.email = 'driver@example.com'
        )
        AND d.current_location IS NOT NULL
    )
    UPDATE drivers d
    SET
      current_location = ST_GeogFromText(
        'SRID=4326;POINT(' ||
        (-73.367 + ((((test_drivers.rn - 1) % 8) - 3.5) * 0.0018))::text ||
        ' ' ||
        (5.535 + (((FLOOR((test_drivers.rn - 1) / 8)::integer % 5) - 2) * 0.0018))::text ||
        ')'
      ),
      updated_at = NOW()
    FROM test_drivers
    WHERE d.user_id = test_drivers.user_id;
  `);
};

exports.down = async function down() {
  // Data-only migration; previous arbitrary demo coordinates are not restored.
};
