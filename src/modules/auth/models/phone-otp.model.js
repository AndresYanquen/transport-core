const { pool } = require("../../../config/database");
const { logger } = require("../../../config/logger");

function limited(retryAfter) {
  return Object.assign(new Error("Too many verification attempts. Please try again later."), {
    status: 429, retryAfter: Math.max(1, Math.ceil(retryAfter)),
  });
}

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// PostgreSQL counters are shared across backend instances and fail closed.
async function takeLimit(client, key, seconds, limit) {
  const { rows } = await client.query(`
    INSERT INTO auth_phone_rate_limits (key, used, reset_at)
    VALUES ($1, 1, clock_timestamp() + $2 * INTERVAL '1 second')
    ON CONFLICT (key) DO UPDATE SET
      used = CASE WHEN auth_phone_rate_limits.reset_at <= clock_timestamp() THEN 1
        ELSE auth_phone_rate_limits.used + 1 END,
      reset_at = CASE WHEN auth_phone_rate_limits.reset_at <= clock_timestamp()
        THEN clock_timestamp() + $2 * INTERVAL '1 second' ELSE auth_phone_rate_limits.reset_at END
    RETURNING used, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - clock_timestamp())))) AS retry_after
  `, [key, seconds]);
  if (rows[0].used > limit) {
    const error = new Error("Too many verification attempts. Please try again later.");
    error.status = 429;
    error.retryAfter = Number(rows[0].retry_after);
    throw error;
  }
}

async function slidingLimit(client, column, key, seconds, limit) {
  // Column names are constants supplied below, never request input.
  const { rows } = await client.query(`SELECT COUNT(*)::integer AS used,
    COALESCE(CEIL(EXTRACT(EPOCH FROM (MIN(created_at) + $1 * INTERVAL '1 second' - clock_timestamp()))), 1) AS retry_after
    FROM auth_phone_sms_requests WHERE created_at > clock_timestamp() - $1 * INTERVAL '1 second'
      ${column ? `AND ${column} = $2` : ""}`, column ? [seconds, key] : [seconds]);
  if (rows[0].used >= limit) throw limited(Number(rows[0].retry_after));
  return rows[0].used + 1;
}

async function reserve({ challengeId, requestId, phoneNumber, accountType, purpose = "auth", targetUserId = null,
  codeHash, phoneKey, deviceKey, ipKey, config }) {
  const result = await transaction(async (client) => {
    // A shared lock serializes budget reservation, idempotency and dispatch decisions.
    // No provider call is made while holding the lock.
    const control = await client.query(`SELECT *,
      EXTRACT(EPOCH FROM (blocked_until - clock_timestamp())) AS retry_after
      FROM auth_phone_sms_control WHERE id = 1 FOR UPDATE`);
    if (!control.rows[0]) throw new Error("SMS control state is missing.");
    const previous = await client.query(`SELECT *, GREATEST(0,
      CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))) AS expires_in
      FROM auth_phone_sms_requests WHERE request_id = $1`, [requestId]);
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (row.phone_key !== phoneKey || row.device_key !== deviceKey || row.account_type !== accountType ||
          row.purpose !== purpose || row.target_user_id !== targetUserId) {
        throw Object.assign(new Error("Invalid verification request."), { status: 400 });
      }
      return { dispatch: false, challengeId: row.challenge_id, status: row.status, expiresIn: Number(row.expires_in) };
    }
    if (Number(control.rows[0].retry_after) > 0) {
      throw Object.assign(new Error("SMS verification is temporarily unavailable."), { status: 503,
        retryAfter: Math.ceil(Number(control.rows[0].retry_after)) });
    }
    const daily = await slidingLimit(client, null, null, 86400, config.globalDailyLimit);
    const minute = await slidingLimit(client, null, null, 60, config.globalMinuteLimit);
    await slidingLimit(client, "ip_key", ipKey, 900, config.ipQuarterHourLimit);
    await slidingLimit(client, "device_key", deviceKey, 3600, config.deviceHourlyLimit);
    await slidingLimit(client, "phone_key", phoneKey, 86400, config.phoneDailyLimit);
    await slidingLimit(client, "phone_key", phoneKey, 3600, config.phoneHourlyLimit);
    await slidingLimit(client, "phone_key", phoneKey, config.resendSeconds, 1);
    const uncertain = await client.query(`SELECT CEIL(EXTRACT(EPOCH FROM
      (MAX(expires_at) - clock_timestamp()))) AS retry_after FROM auth_phone_sms_requests
      WHERE phone_key = $1 AND status IN ('pending', 'unknown') AND expires_at > clock_timestamp()`, [phoneKey]);
    if (Number(uncertain.rows[0].retry_after) > 0) throw limited(Number(uncertain.rows[0].retry_after));
    await client.query(`INSERT INTO auth_phone_sms_requests
      (challenge_id, request_id, phone_key, device_key, ip_key, account_type, expires_at, created_at, purpose, target_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + $7 * INTERVAL '1 second', clock_timestamp(), $8, $9)`,
    [challengeId, requestId, phoneKey, deviceKey, ipKey, accountType, config.ttlSeconds, purpose, targetUserId]);
    await client.query(`
      INSERT INTO auth_phone_otps (phone_number, challenge_id, account_type, code_hash, expires_at, purpose, target_user_id)
      VALUES ($1, $2, $3, $4, clock_timestamp() + $5 * INTERVAL '1 second', $6, $7)
      ON CONFLICT (phone_number) DO UPDATE SET
        challenge_id = EXCLUDED.challenge_id, account_type = EXCLUDED.account_type,
        purpose = EXCLUDED.purpose, target_user_id = EXCLUDED.target_user_id,
        code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
        status = 'pending', attempts = 0, created_at = clock_timestamp()
    `, [phoneNumber, challengeId, accountType, codeHash, config.ttlSeconds, purpose, targetUserId]);
    return { dispatch: true, challengeId, status: "pending", expiresIn: config.ttlSeconds, daily, minute };
  });
  if (result.dispatch) {
    for (const [scope, used, limit] of [["day", result.daily, config.globalDailyLimit], ["minute", result.minute, config.globalMinuteLimit]]) {
      if (used === Math.ceil(limit * 0.8) || used === limit) {
        logger.warn("phone_otp_sms_budget_alert", { scope, used, limit, exhausted: used === limit });
      }
    }
  }
  return result;
}

async function markDelivery(challengeId, sent, { unknown = false, blockProvider = false, providerReference = null } = {}) {
  await transaction(async (client) => {
    // Use the same lock order as reserve to avoid a resend/declaration deadlock.
    await client.query("SELECT id FROM auth_phone_sms_control WHERE id = 1 FOR UPDATE");
    await client.query(`UPDATE auth_phone_sms_requests SET status = $2, provider_reference = $3
      WHERE challenge_id = $1 AND status = 'pending'`, [challengeId, sent ? "sent" : unknown ? "unknown" : "failed", providerReference]);
    await client.query(`UPDATE auth_phone_otps SET status = $2
      WHERE challenge_id = $1 AND status = 'pending'`, [challengeId, sent ? "sent" : "failed"]);
    if (blockProvider) {
      await client.query(`UPDATE auth_phone_sms_control SET blocked_until = clock_timestamp() + INTERVAL '15 minutes',
        blocked_reason = 'provider_rejected' WHERE id = 1`);
    }
  });
  if (blockProvider) logger.error("phone_otp_sms_provider_blocked", { durationSeconds: 900 });
}

async function verify({ challengeId, deviceKey, purpose = "auth", targetUserId = null,
  codeMatches, phoneKeyFor, ipKey, config, complete }) {
  return transaction(async (client) => {
    await takeLimit(client, `verify:ip:${ipKey}`, 900, 60);
    const { rows } = await client.query(`
      SELECT otp.*, sms.device_key FROM auth_phone_otps otp
      LEFT JOIN auth_phone_sms_requests sms USING (challenge_id)
      WHERE otp.challenge_id = $1 FOR UPDATE OF otp
    `, [challengeId]);
    const challenge = rows[0];
    if (!challenge || challenge.device_key !== deviceKey || challenge.purpose !== purpose ||
        challenge.target_user_id !== targetUserId || challenge.status !== "sent" || challenge.attempts >= config.maxAttempts) {
      return null;
    }
    // Recheck the clock after the row lock has actually been acquired.
    const validity = await client.query(`SELECT expires_at > clock_timestamp() AS valid
      FROM auth_phone_otps WHERE challenge_id = $1`, [challengeId]);
    if (!validity.rows[0]?.valid) return null;
    await takeLimit(client, `verify:phone:${phoneKeyFor(challenge.phone_number)}`, 900, config.maxAttempts);
    if (!codeMatches(challenge)) {
      await client.query("UPDATE auth_phone_otps SET attempts = attempts + 1 WHERE challenge_id = $1", [challengeId]);
      return null;
    }
    // Complete account creation, verification, token issuance and consumption together.
    const result = await complete(challenge, client);
    if (!result) return null;
    await client.query("UPDATE auth_phone_otps SET status = 'consumed' WHERE challenge_id = $1", [challengeId]);
    return result;
  });
}

module.exports = { reserve, markDelivery, verify };
