const bcrypt = require("bcryptjs");

const AuthModel = require("../../auth/models/auth.model");
const SettingsService = require("../../settings/services/settings.service");
const { normalizePhoneNumber } = require("../../auth/utils/phone");
const { query } = require("../../../config/database");

const PASSWORD_SALT_ROUNDS = 12;

function normalizeRole(role) {
  return String(role || "client").toLowerCase();
}

async function createUser(payload) {
  const role = normalizeRole(payload.role);
  const passwordHash = await bcrypt.hash(payload.password, PASSWORD_SALT_ROUNDS);
  const phoneNumber = payload.phoneNumber
    ? normalizePhoneNumber(payload.phoneNumber)
    : null;

  const userRow = await AuthModel.createUser({
    email: payload.email,
    username: payload.username,
    passwordHash,
    firstName: payload.firstName,
    lastName: payload.lastName,
    phoneNumber,
    accountType: role,
    status: payload.status || "active",
    clientProfile: role === "client" ? payload.clientProfile || {} : undefined,
    driverProfile: role === "driver"
      ? {
          ...(payload.driverProfile || {}),
          approvalStatus:
            (await SettingsService.getSettingValue("driver_creation_approval_policy", "pending")) === "auto_approved"
              ? "approved"
              : "pending",
        }
      : undefined,
  });

  return {
    user: AuthModel.toPublicUser(userRow),
  };
}

async function listUsers({ limit = 50, offset = 0, role = "", search = "" } = {}) {
  const clauses = ["u.deleted_at IS NULL"];
  const values = [];
  let index = 1;
  const includeClientProfile = role === "client";
  const includeOperatorProfile = role === "operator";

  if (role) {
    clauses.push(`u.role = $${index}`);
    values.push(role);
    index += 1;
  }

  if (search) {
    clauses.push(`(
      u.email ILIKE $${index}
      OR u.username ILIKE $${index}
      OR u.first_name ILIKE $${index}
      OR u.last_name ILIKE $${index}
      OR u.phone_number ILIKE $${index}
    )`);
    values.push(`%${search}%`);
    index += 1;
  }

  values.push(limit, offset);

  const { rows } = await query(
    `
      SELECT
        u.id,
        u.email,
        u.username,
        u.first_name,
        u.last_name,
        u.phone_number,
        u.profile_image_url,
        u.role,
        u.status,
        ${includeOperatorProfile ? "u.profile," : ""}
        u.email_verified,
        u.phone_verified,
        u.last_login_at,
        u.created_at,
        u.updated_at
        ${includeClientProfile ? `,
        c.default_payment_method AS client_default_payment_method,
        c.rating AS client_rating` : ""}
      FROM users u
      ${includeClientProfile ? "LEFT JOIN clients c ON c.user_id = u.id" : ""}
      WHERE ${clauses.join(" AND ")}
      ORDER BY u.created_at DESC
      LIMIT $${index}
      OFFSET $${index + 1}
    `,
    values,
  );

  return {
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      phoneNumber: row.phone_number,
      profileImageUrl: row.profile_image_url,
      role: row.role,
      status: row.status,
      operatorProfile: includeOperatorProfile
        ? {
            employeeCode: row.profile?.operator?.employeeCode ?? null,
            shift: row.profile?.operator?.shift ?? null,
            operationZone: row.profile?.operator?.operationZone ?? null,
            specialties: Array.isArray(row.profile?.operator?.specialties)
              ? row.profile.operator.specialties
              : [],
          }
        : undefined,
      emailVerified: row.email_verified,
      phoneVerified: row.phone_verified,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      clientProfile: includeClientProfile
        ? {
            defaultPaymentMethod: row.client_default_payment_method,
            rating: row.client_rating === null ? null : Number(row.client_rating),
          }
        : undefined,
    })),
  };
}

function mapDriverApproval(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    phoneNumber: row.phone_number,
    profileImageUrl: row.profile_image_url,
    status: row.status,
    createdAt: row.created_at,
    driverProfile: {
      licenseNumber: row.license_number,
      vehicleMake: row.vehicle_make,
      vehicleModel: row.vehicle_model,
      vehicleYear: row.vehicle_year,
      vehicleColor: row.vehicle_color,
      vehiclePlate: row.vehicle_plate,
      vehicleType: row.vehicle_type,
      serviceTypes: row.service_types || [],
      documents: row.documents || {},
      approvalStatus: row.approval_status,
      approvalNotes: row.approval_notes,
      reviewedByAdminId: row.reviewed_by_admin_id,
      reviewedAt: row.reviewed_at,
      onboardedAt: row.onboarded_at,
    },
  };
}

async function listDriverApprovals({ status = "pending", limit = 100, offset = 0, search = "" } = {}) {
  const clauses = ["u.deleted_at IS NULL", "u.role = 'driver'"];
  const values = [];
  let index = 1;

  if (status && status !== "all") {
    clauses.push(`d.approval_status = $${index}`);
    values.push(status);
    index += 1;
  }

  if (search) {
    clauses.push(`(
      u.email ILIKE $${index}
      OR u.username ILIKE $${index}
      OR u.first_name ILIKE $${index}
      OR u.last_name ILIKE $${index}
      OR u.phone_number ILIKE $${index}
      OR d.license_number ILIKE $${index}
      OR d.vehicle_plate ILIKE $${index}
    )`);
    values.push(`%${search}%`);
    index += 1;
  }

  values.push(limit, offset);

  const { rows } = await query(
    `
      SELECT
        u.id,
        u.email,
        u.username,
        u.first_name,
        u.last_name,
        u.phone_number,
        u.profile_image_url,
        u.status,
        u.created_at,
        d.license_number,
        d.vehicle_make,
        d.vehicle_model,
        d.vehicle_year,
        d.vehicle_color,
        d.vehicle_plate,
        d.vehicle_type,
        COALESCE(
          (
            SELECT array_agg(dst.service_type_code ORDER BY st.sort_order ASC, st.name ASC)
            FROM driver_service_types dst
            JOIN service_types st ON st.code = dst.service_type_code
            WHERE dst.driver_id = d.user_id
              AND dst.is_active = true
              AND st.is_active = true
          ),
          ARRAY[]::text[]
        ) AS service_types,
        d.documents,
        d.approval_status,
        d.approval_notes,
        d.reviewed_by_admin_id,
        d.reviewed_at,
        d.onboarded_at
      FROM users u
      JOIN drivers d ON d.user_id = u.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY
        CASE d.approval_status
          WHEN 'pending' THEN 1
          WHEN 'changes_requested' THEN 2
          WHEN 'rejected' THEN 3
          WHEN 'suspended' THEN 4
          ELSE 5
        END,
        u.created_at DESC
      LIMIT $${index}
      OFFSET $${index + 1}
    `,
    values,
  );

  return { drivers: rows.map(mapDriverApproval) };
}

async function updateDriverApproval(driverId, { approvalStatus, approvalNotes = "" }, adminId) {
  const { rows, rowCount } = await query(
    `
      UPDATE drivers
      SET
        approval_status = $2,
        approval_notes = $3,
        reviewed_by_admin_id = $4,
        reviewed_at = NOW(),
        status = CASE
          WHEN $2 = 'approved' THEN status
          ELSE CASE WHEN status = 'busy' THEN 'busy' ELSE 'offline' END
        END,
        availability_intent = CASE
          WHEN $2 = 'approved' THEN availability_intent
          ELSE 'offline'
        END,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id
    `,
    [driverId, approvalStatus, approvalNotes || null, adminId],
  );

  if (!rowCount) {
    const error = new Error("Driver not found.");
    error.status = 404;
    throw error;
  }

  return {
    driverId: rows[0].user_id,
    approvalStatus,
    approvalNotes: approvalNotes || null,
  };
}

module.exports = {
  createUser,
  listDriverApprovals,
  listUsers,
  updateDriverApproval,
};
