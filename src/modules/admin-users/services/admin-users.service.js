const bcrypt = require("bcryptjs");

const AuthModel = require("../../auth/models/auth.model");
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
    driverProfile: role === "driver" ? payload.driverProfile || {} : undefined,
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

module.exports = {
  createUser,
  listUsers,
};
