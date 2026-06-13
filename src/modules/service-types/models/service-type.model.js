const { query } = require("../../../config/database");

const BASE_FIELDS = `
  id,
  code,
  name,
  description,
  icon,
  base_price,
  is_active,
  sort_order,
  created_at,
  updated_at
`;

function toServiceType(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    icon: row.icon,
    basePrice: Number(row.base_price ?? 0),
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ServiceTypeModel {
  static async list({ includeInactive = false } = {}) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM service_types
        WHERE ($1::boolean = true OR is_active = true)
        ORDER BY sort_order ASC, name ASC
      `,
      [includeInactive]
    );

    return rows.map(toServiceType);
  }

  static async findByCode(code) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM service_types
        WHERE code = $1
      `,
      [code]
    );

    return toServiceType(rows[0]);
  }

  static async listActiveCodes() {
    const { rows } = await query(
      `
        SELECT code
        FROM service_types
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC
      `
    );

    return rows.map((row) => row.code);
  }

  static async create(serviceType) {
    const { rows } = await query(
      `
        INSERT INTO service_types (
          code,
          name,
          description,
          icon,
          base_price,
          is_active,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING ${BASE_FIELDS}
      `,
      [
        serviceType.code,
        serviceType.name,
        serviceType.description,
        serviceType.icon,
        serviceType.basePrice,
        serviceType.isActive,
        serviceType.sortOrder,
      ]
    );

    return toServiceType(rows[0]);
  }

  static async updateByCode(code, patch) {
    const { rows } = await query(
      `
        UPDATE service_types
        SET
          name = COALESCE($2, name),
          description = CASE WHEN $3::boolean THEN $4 ELSE description END,
          icon = CASE WHEN $5::boolean THEN $6 ELSE icon END,
          base_price = COALESCE($7, base_price),
          is_active = COALESCE($8, is_active),
          sort_order = COALESCE($9, sort_order)
        WHERE code = $1
        RETURNING ${BASE_FIELDS}
      `,
      [
        code,
        patch.name ?? null,
        patch.hasDescription,
        patch.description ?? null,
        patch.hasIcon,
        patch.icon ?? null,
        patch.basePrice ?? null,
        patch.isActive ?? null,
        patch.sortOrder ?? null,
      ]
    );

    return toServiceType(rows[0]);
  }

  static async deleteByCode(code) {
    const { rows } = await query(
      `
        DELETE FROM service_types
        WHERE code = $1
        RETURNING id
      `,
      [code]
    );

    return Boolean(rows[0]);
  }
}

module.exports = ServiceTypeModel;
