const { query } = require("../../../config/database");

const BASE_FIELDS = `
  id,
  code,
  category,
  name,
  description,
  icon,
  color,
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
    category: row.category,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    basePrice: Number(row.base_price ?? 0),
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ServiceTypeModel {
  static async list({ includeInactive = false, category = null } = {}) {
    const { rows } = await query(
      `
        SELECT ${BASE_FIELDS}
        FROM service_types
        WHERE ($1::boolean = true OR is_active = true)
          AND ($2::text IS NULL OR category = $2)
        ORDER BY sort_order ASC, name ASC
      `,
      [includeInactive, category]
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
          category,
          name,
          description,
          icon,
          color,
          base_price,
          is_active,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING ${BASE_FIELDS}
      `,
      [
        serviceType.code,
        serviceType.category,
        serviceType.name,
        serviceType.description,
        serviceType.icon,
        serviceType.color,
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
          category = COALESCE($3, category),
          description = CASE WHEN $4::boolean THEN $5 ELSE description END,
          icon = CASE WHEN $6::boolean THEN $7 ELSE icon END,
          color = CASE WHEN $8::boolean THEN $9 ELSE color END,
          base_price = COALESCE($10, base_price),
          is_active = COALESCE($11, is_active),
          sort_order = COALESCE($12, sort_order)
        WHERE code = $1
        RETURNING ${BASE_FIELDS}
      `,
      [
        code,
        patch.name ?? null,
        patch.category ?? null,
        patch.hasDescription,
        patch.description ?? null,
        patch.hasIcon,
        patch.icon ?? null,
        patch.hasColor,
        patch.color ?? null,
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
