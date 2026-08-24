const { query } = require("../../../config/database");

const KNOWN_ROLES = ["admin", "operator", "client", "driver"];

function mapPermission(row) {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listPermissions() {
  const { rows } = await query(
    `
      SELECT code, name, description, created_at, updated_at
      FROM admin_permissions
      ORDER BY code ASC
    `,
  );

  return { permissions: rows.map(mapPermission) };
}

async function listRoles() {
  const { rows } = await query(
    `
      SELECT
        rp.role,
        p.code,
        p.name,
        p.description
      FROM admin_role_permissions rp
      JOIN admin_permissions p ON p.code = rp.permission_code
      ORDER BY rp.role ASC, p.code ASC
    `,
  );

  const rolesByName = new Map(
    KNOWN_ROLES.map((role) => [role, { role, permissions: [] }]),
  );

  for (const row of rows) {
    if (!rolesByName.has(row.role)) {
      rolesByName.set(row.role, { role: row.role, permissions: [] });
    }
    rolesByName.get(row.role).permissions.push({
      code: row.code,
      name: row.name,
      description: row.description,
    });
  }

  return { roles: [...rolesByName.values()] };
}

async function listAuditEvents({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number.trunc(Number(limit) || 100), 1), 200);
  const { rows } = await query(
    `
      SELECT *
      FROM (
        SELECT
          'ride' AS source,
          id::text AS id,
          ride_id::text AS entity_id,
          status AS event_type,
          actor_id::text AS actor_id,
          actor_type AS actor_role,
          metadata,
          occurred_at
        FROM ride_events
        UNION ALL
        SELECT
          'radio' AS source,
          id::text AS id,
          session_id::text AS entity_id,
          event_type,
          actor_id::text AS actor_id,
          actor_role,
          metadata,
          occurred_at
        FROM radio_session_events
      ) audit_events
      ORDER BY occurred_at DESC
      LIMIT $1
    `,
    [safeLimit],
  );

  return {
    events: rows.map((row) => ({
      source: row.source,
      id: row.id,
      entityId: row.entity_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      metadata: row.metadata || {},
      occurredAt: row.occurred_at,
    })),
  };
}

module.exports = {
  listAuditEvents,
  listPermissions,
  listRoles,
};
