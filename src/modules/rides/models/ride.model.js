const { pool, query } = require("../../../config/database");
const { RideInviteStatus } = require("../constants/ride-invite-status");
const { TERMINAL_RIDE_STATUSES } = require("../constants/ride-status");

const BASE_RIDE_FIELDS = `
  id,
  client_id,
  driver_id,
  status,
  service_type,
  pickup_address,
  dropoff_address,
  has_destination,
  ST_AsGeoJSON(pickup_point)::jsonb AS pickup_point_geojson,
  ST_AsGeoJSON(dropoff_point)::jsonb AS dropoff_point_geojson,
  estimated_distance_meters,
  estimated_duration_seconds,
  actual_distance_meters,
  actual_duration_seconds,
  estimated_fare_amount,
  final_fare_amount,
  surge_multiplier,
  currency,
  payment_reference,
  pricing_breakdown,
  cancellation_reason,
  scheduled_at,
  requested_at,
  accepted_at,
  driver_arrived_at,
  started_at,
  completed_at,
  canceled_at,
  created_at,
  updated_at
`;

const BASE_EVENT_FIELDS = `
  id,
  ride_id,
  status,
  actor_type,
  actor_id,
  payload,
  occurred_at,
  created_at
`;

function getExecutor(dbClient) {
  if (dbClient) {
    return dbClient;
  }

  return {
    query: (text, params) => query(text, params),
  };
}

function parseJson(jsonValue) {
  if (jsonValue === null || jsonValue === undefined) {
    return null;
  }

  if (typeof jsonValue === "object") {
    return jsonValue;
  }

  try {
    return JSON.parse(jsonValue);
  } catch (_err) {
    return null;
  }
}

function toNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

class RideModel {
  static async insertRide(dbClient, {
    clientId,
    driverId = null,
    status,
    serviceType,
    pickupAddress,
    dropoffAddress,
    hasDestination,
    pickupLocation,
    dropoffLocation,
    estimatedDistanceMeters,
    estimatedDurationSeconds,
    actualDistanceMeters,
    actualDurationSeconds,
    estimatedFareAmount,
    finalFareAmount,
    surgeMultiplier,
    currency,
    paymentReference,
    pricingBreakdown,
    cancellationReason,
    scheduledAt,
  }) {
    const executor = getExecutor(dbClient);
    const pickupLat = toNullableNumber(pickupLocation?.lat);
    const pickupLng = toNullableNumber(pickupLocation?.lng);
    const dropoffLat = toNullableNumber(dropoffLocation?.lat);
    const dropoffLng = toNullableNumber(dropoffLocation?.lng);

    const dropoffWkt =
      dropoffLat !== null && dropoffLng !== null
        ? `SRID=4326;POINT(${dropoffLng} ${dropoffLat})`
        : null;

    const pickupWkt =
      pickupLat !== null && pickupLng !== null
        ? `SRID=4326;POINT(${pickupLng} ${pickupLat})`
        : null;


    const estimatedDistance = toNullableNumber(estimatedDistanceMeters);
    const estimatedDuration = toNullableNumber(estimatedDurationSeconds);
    const actualDistance = toNullableNumber(actualDistanceMeters);
    const actualDuration = toNullableNumber(actualDurationSeconds);
    const estimatedFare = toNullableNumber(estimatedFareAmount);
    const finalFare = toNullableNumber(finalFareAmount);
    const surge = toNullableNumber(surgeMultiplier) ?? 1;


    const { rows } = await executor.query(
      `
        INSERT INTO rides (
          client_id,
          driver_id,
          status,
          service_type,
          pickup_address,
          dropoff_address,
          has_destination,
          pickup_point,
          dropoff_point,
          estimated_distance_meters,
          estimated_duration_seconds,
          actual_distance_meters,
          actual_duration_seconds,
          estimated_fare_amount,
          final_fare_amount,
          surge_multiplier,
          currency,
          payment_reference,
          pricing_breakdown,
          cancellation_reason,
          scheduled_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          CASE WHEN $8::text IS NULL THEN NULL
              ELSE ST_GeogFromText($8::text)
          END,
          CASE WHEN $9::text IS NULL THEN NULL
              ELSE ST_GeogFromText($9::text)
          END,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          COALESCE($19::jsonb, '{}'::jsonb),
          $20,
          $21
        )
        RETURNING ${BASE_RIDE_FIELDS}
      `,
      [
        clientId,
        driverId,
        status,
        serviceType,
        pickupAddress ?? null,
        dropoffAddress ?? null,
        Boolean(hasDestination),
        pickupWkt,
        dropoffWkt,
        estimatedDistance,
        estimatedDuration,
        actualDistance,
        actualDuration,
        estimatedFare,
        finalFare,
        surge,
        currency ?? "USD",
        paymentReference ?? null,
        pricingBreakdown ? JSON.stringify(pricingBreakdown) : null,
        cancellationReason ?? null,
        scheduledAt ?? null,
      ]
    );

    return rows[0] ?? null;
  }

  static async insertRideEvent(dbClient, {
    rideId,
    status,
    actorType,
    actorId = null,
    payload = {},
    occurredAt = null,
  }) {
    const executor = getExecutor(dbClient);
    const { rows } = await executor.query(
      `
        INSERT INTO ride_events (
          ride_id,
          status,
          actor_type,
          actor_id,
          payload,
          occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
        RETURNING ${BASE_EVENT_FIELDS}
      `,
      [rideId, status, actorType, actorId, JSON.stringify(payload ?? {}), occurredAt]
    );

    return rows[0] ?? null;
  }

  static async getRideById(
    rideId,
    { includeDriver = false, includePassenger = false, dbClient } = {}
  ) {
    const executor = getExecutor(dbClient);
    const driverSelect = includeDriver
      ? `,
          du.first_name AS driver_first_name,
          du.last_name AS driver_last_name,
          du.email AS driver_email,
          du.phone_number AS driver_phone_number,
          d.vehicle_make AS driver_vehicle_make,
          d.vehicle_model AS driver_vehicle_model,
          d.vehicle_year AS driver_vehicle_year,
          d.vehicle_color AS driver_vehicle_color,
          d.vehicle_plate AS driver_vehicle_plate,
          d.vehicle_type AS driver_vehicle_type,
          d.status AS driver_status,
          ST_AsGeoJSON(d.current_location)::jsonb AS driver_current_location_geojson,
          d.heading_degrees AS driver_heading_degrees,
          d.speed_kmh AS driver_speed_kmh`
      : "";

    const driverJoin = includeDriver
      ? `
        LEFT JOIN drivers d ON d.user_id = r.driver_id
        LEFT JOIN users du ON du.id = d.user_id
      `
      : "";

    const passengerSelect = includePassenger
      ? `,
          cu.first_name AS client_first_name,
          cu.last_name AS client_last_name,
          cu.email AS client_email,
          cu.phone_number AS client_phone_number`
      : "";

    const passengerJoin = includePassenger
      ? "LEFT JOIN users cu ON cu.id = r.client_id"
      : "";

    const { rows } = await executor.query(
      `
        SELECT
          r.*
          ${driverSelect}
          ${passengerSelect}
        FROM (
          SELECT ${BASE_RIDE_FIELDS}
          FROM rides
        ) r
        ${driverJoin}
        ${passengerJoin}
        WHERE r.id = $1
      `,
      [rideId]
    );

    return rows[0] ?? null;
  }

  static async getRideByIdForUpdate(rideId, dbClient) {
    const executor = getExecutor(dbClient);
    const { rows } = await executor.query(
      `
        SELECT ${BASE_RIDE_FIELDS}
        FROM rides
        WHERE id = $1
        FOR UPDATE
      `,
      [rideId]
    );

    return rows[0] ?? null;
  }

  static async getActiveRideByClientId(dbClient, clientId, { forUpdate = false } = {}) {
    const executor = getExecutor(dbClient);
    const terminalStatuses = Array.from(TERMINAL_RIDE_STATUSES);
    const { rows } = await executor.query(
      `
        SELECT ${BASE_RIDE_FIELDS}
        FROM rides
        WHERE client_id = $1
          AND status <> ALL($2::text[])
        ORDER BY updated_at DESC
        LIMIT 1
        ${forUpdate ? "FOR UPDATE" : ""}
      `,
      [clientId, terminalStatuses]
    );

    return rows[0] ?? null;
  }

  static async listRideEvents(rideId, { limit = 20, offset = 0 } = {}, dbClient) {
    const executor = getExecutor(dbClient);
    const { rows } = await executor.query(
      `
        SELECT ${BASE_EVENT_FIELDS}
        FROM ride_events
        WHERE ride_id = $1
        ORDER BY occurred_at ASC, created_at ASC
        LIMIT $2
        OFFSET $3
      `,
      [rideId, limit, offset]
    );

    return rows;
  }

  static async updateRide(dbClient, rideId, { fields = {}, expressions = [] } = {}) {
    const executor = getExecutor(dbClient);
    const assignments = [];
    const values = [];
    let index = 1;

    for (const [column, value] of Object.entries(fields)) {
      assignments.push(`${column} = $${index}`);
      values.push(value);
      index += 1;
    }

    expressions.forEach((expression) => {
      assignments.push(expression);
    });

    if (assignments.length === 0) {
      const { rows } = await executor.query(
        `
          SELECT ${BASE_RIDE_FIELDS}
          FROM rides
          WHERE id = $1
        `,
        [rideId]
      );

      return rows[0] ?? null;
    }

    const { rows } = await executor.query(
      `
        UPDATE rides
        SET ${assignments.join(", ")}
        WHERE id = $${index}
        RETURNING ${BASE_RIDE_FIELDS}
      `,
      [...values, rideId]
    );

    return rows[0] ?? null;
  }

  static mapRideRow(row) {
    if (!row) {
      return null;
    }

    const pickupGeo = parseJson(row.pickup_point_geojson);
    const dropoffGeo = parseJson(row.dropoff_point_geojson);

    const pickupLocation =
      pickupGeo && Array.isArray(pickupGeo.coordinates)
        ? {
            lat: pickupGeo.coordinates[1],
            lng: pickupGeo.coordinates[0],
          }
        : null;

    const dropoffLocation =
      dropoffGeo && Array.isArray(dropoffGeo.coordinates)
        ? {
            lat: dropoffGeo.coordinates[1],
            lng: dropoffGeo.coordinates[0],
          }
        : null;

    return {
      id: row.id,
      clientId: row.client_id,
      passenger:
        row.client_first_name !== undefined ||
        row.client_last_name !== undefined ||
        row.client_email !== undefined ||
        row.client_phone_number !== undefined
          ? {
              firstName: row.client_first_name ?? null,
              lastName: row.client_last_name ?? null,
              fullName: [row.client_first_name, row.client_last_name]
                .filter(Boolean)
                .join(" ")
                .trim() || null,
              email: row.client_email ?? null,
              phoneNumber: row.client_phone_number ?? null,
            }
          : null,
      driver:
        row.driver_first_name !== undefined ||
        row.driver_last_name !== undefined ||
        row.driver_email !== undefined ||
        row.driver_phone_number !== undefined ||
        row.driver_vehicle_plate !== undefined
          ? {
              firstName: row.driver_first_name ?? null,
              lastName: row.driver_last_name ?? null,
              fullName: [row.driver_first_name, row.driver_last_name]
                .filter(Boolean)
                .join(" ")
                .trim() || null,
              email: row.driver_email ?? null,
              phoneNumber: row.driver_phone_number ?? null,
              vehicleMake: row.driver_vehicle_make ?? null,
              vehicleModel: row.driver_vehicle_model ?? null,
              vehicleYear: row.driver_vehicle_year ?? null,
              vehicleColor: row.driver_vehicle_color ?? null,
              vehiclePlate: row.driver_vehicle_plate ?? null,
              vehicleType: row.driver_vehicle_type ?? null,
              status: row.driver_status ?? null,
              currentLocation: (() => {
                const geo = parseJson(row.driver_current_location_geojson);
                if (!geo || !Array.isArray(geo.coordinates)) {
                  return row.driver_id ? { lat: null, lng: null } : null;
                }

                return {
                  lat: geo.coordinates[1],
                  lng: geo.coordinates[0],
                };
              })(),
              headingDegrees: row.driver_heading_degrees ?? null,
              speedKmh: row.driver_speed_kmh ?? null,
            }
          : null,
      driverLocation: (() => {
        const geo = parseJson(row.driver_current_location_geojson);
        if (!geo || !Array.isArray(geo.coordinates)) {
          return row.driver_id ? { lat: null, lng: null } : null;
        }

        return {
          lat: geo.coordinates[1],
          lng: geo.coordinates[0],
        };
      })(),
      driverId: row.driver_id,
      status: row.status,
      serviceType: row.service_type,
      pickupAddress: row.pickup_address,
      dropoffAddress: row.dropoff_address,
      hasDestination:
        row.has_destination !== undefined && row.has_destination !== null
          ? Boolean(row.has_destination)
          : Boolean(dropoffLocation || row.dropoff_address),
      pickupLocation,
      dropoffLocation,
      estimatedDistanceMeters: row.estimated_distance_meters,
      estimatedDurationSeconds: row.estimated_duration_seconds,
      actualDistanceMeters: row.actual_distance_meters,
      actualDurationSeconds: row.actual_duration_seconds,
      estimatedFareAmount: row.estimated_fare_amount,
      finalFareAmount: row.final_fare_amount,
      surgeMultiplier: Number(row.surge_multiplier ?? 1),
      currency: row.currency,
      paymentReference: row.payment_reference,
      pricingBreakdown: parseJson(row.pricing_breakdown) ?? {},
      cancellationReason: row.cancellation_reason,
      scheduledAt: row.scheduled_at,
      requestedAt: row.requested_at,
      acceptedAt: row.accepted_at,
      driverArrivedAt: row.driver_arrived_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      canceledAt: row.canceled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static mapEventRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      rideId: row.ride_id,
      status: row.status,
      actorType: row.actor_type,
      actorId: row.actor_id,
      payload: parseJson(row.payload) ?? {},
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    };
  }

  static mapInviteRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      rideId: row.ride_id,
      driverId: row.driver_id,
      status: row.status,
      invitedAt: row.invited_at,
      respondedAt: row.responded_at,
    };
  }

  static async insertDriverInvites(dbClient, rideId, driverIds) {
    if (!driverIds || !driverIds.length) {
      return [];
    }

    const executor = getExecutor(dbClient);
    const invites = [];

    for (const driverId of driverIds) {
      const { rows } = await executor.query(
        `
          INSERT INTO ride_driver_invites (ride_id, driver_id, status)
          VALUES ($1, $2, $3)
          ON CONFLICT (ride_id, driver_id)
          DO UPDATE SET
            status = EXCLUDED.status,
            responded_at = NULL
          RETURNING *
        `,
        [rideId, driverId, RideInviteStatus.PENDING]
      );

      invites.push(RideModel.mapInviteRow(rows[0]));
    }

    return invites;
  }

  static async listDriverInvites(dbClient, rideId, { statuses } = {}) {
    const executor = getExecutor(dbClient);
    const params = [rideId];
    let filter = "";

    if (statuses && statuses.length) {
      params.push(statuses);
      filter = "AND status = ANY($2::text[])";
    }

    const { rows } = await executor.query(
      `
        SELECT *
        FROM ride_driver_invites
        WHERE ride_id = $1
        ${filter}
        ORDER BY invited_at ASC
      `,
      params
    );

    return rows.map(RideModel.mapInviteRow);
  }

  static async listDriverInvitesForDriver(
    {
      driverId,
      statuses,
      limit = 25,
      offset = 0,
    } = {},
    dbClient
  ) {
    const executor = getExecutor(dbClient);
    const params = [driverId];
    const conditions = ["i.driver_id = $1"];

    if (statuses && statuses.length) {
      params.push(statuses);
      conditions.push(`i.status = ANY($${params.length}::text[])`);
    }

    params.push(limit);
    const limitIndex = params.length;
    params.push(offset);
    const offsetIndex = params.length;

    const { rows } = await executor.query(
      `
        SELECT
          i.id AS invite_id,
          i.ride_id AS invite_ride_id,
          i.driver_id AS invite_driver_id,
          i.status AS invite_status,
          i.invited_at AS invite_invited_at,
          i.responded_at AS invite_responded_at,
          ST_Distance(r.pickup_point, d.current_location) AS pickup_distance_meters,
          r.*,
          cu.first_name AS client_first_name,
          cu.last_name AS client_last_name,
          cu.email AS client_email,
          cu.phone_number AS client_phone_number
        FROM ride_driver_invites i
        JOIN drivers d ON d.user_id = i.driver_id
        JOIN (
          SELECT ${BASE_RIDE_FIELDS}, pickup_point
          FROM rides
        ) r ON r.id = i.ride_id
        JOIN users cu ON cu.id = r.client_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY pickup_distance_meters ASC NULLS LAST, i.invited_at DESC, i.id DESC
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      params
    );

    return rows.map((row) => ({
      invite: RideModel.mapInviteRow({
        id: row.invite_id,
        ride_id: row.invite_ride_id,
        driver_id: row.invite_driver_id,
        status: row.invite_status,
        invited_at: row.invite_invited_at,
        responded_at: row.invite_responded_at,
      }),
      pickupDistanceMeters:
        row.pickup_distance_meters !== undefined && row.pickup_distance_meters !== null
          ? Number(row.pickup_distance_meters)
          : null,
      ride: RideModel.mapRideRow(row),
    }));
  }

  static async listPendingRidesNearDriver(
    {
      driverId,
      driverLocationWkt,
      radiusMeters = 2000,
      limit = 10,
    } = {},
    dbClient
  ) {
    if (!driverId || !driverLocationWkt) {
      return [];
    }

    const executor = getExecutor(dbClient);
    const { rows } = await executor.query(
      `
        SELECT
          ${BASE_RIDE_FIELDS},
          ST_Distance(
            pickup_point,
            ST_GeogFromText($2)
          ) AS distance_meters
        FROM rides r
        WHERE r.status = 'pending_driver'
          AND r.pickup_point IS NOT NULL
          AND ST_DWithin(r.pickup_point, ST_GeogFromText($2), $3)
          AND NOT EXISTS (
            SELECT 1
            FROM ride_driver_invites i
            WHERE i.ride_id = r.id
              AND i.driver_id = $1
          )
        ORDER BY distance_meters ASC, r.requested_at ASC
        LIMIT $4
      `,
      [driverId, driverLocationWkt, radiusMeters, limit]
    );

    return rows;
  }

  static async getDriverInvite(dbClient, rideId, driverId, { forUpdate = false } = {}) {
    const executor = getExecutor(dbClient);
    const { rows } = await executor.query(
      `
        SELECT *
        FROM ride_driver_invites
        WHERE ride_id = $1
          AND driver_id = $2
        ${forUpdate ? "FOR UPDATE" : ""}
      `,
      [rideId, driverId]
    );

    return RideModel.mapInviteRow(rows[0]);
  }

  static async updateDriverInviteStatus(dbClient, rideId, driverId, status) {
    const executor = getExecutor(dbClient);
    const { rows } = await executor.query(
      `
        UPDATE ride_driver_invites
        SET status = $3,
            responded_at = NOW()
        WHERE ride_id = $1
          AND driver_id = $2
        RETURNING *
      `,
      [rideId, driverId, status]
    );

    return RideModel.mapInviteRow(rows[0]);
  }

  static async expirePendingInvitesExcept(dbClient, rideId, driverId) {
    const executor = getExecutor(dbClient);
    await executor.query(
      `
        UPDATE ride_driver_invites
        SET status = $2,
            responded_at = COALESCE(responded_at, NOW())
        WHERE ride_id = $1
          AND driver_id <> $3
          AND status = $4
      `,
      [rideId, RideInviteStatus.EXPIRED, driverId, RideInviteStatus.PENDING]
    );
  }

  static async resetPendingInvites(dbClient, rideId) {
    const executor = getExecutor(dbClient);
    await executor.query(
      `
        UPDATE ride_driver_invites
        SET status = $2,
            responded_at = COALESCE(responded_at, NOW())
        WHERE ride_id = $1
          AND status = $3
      `,
      [rideId, RideInviteStatus.EXPIRED, RideInviteStatus.PENDING]
    );
  }

  static async expireAllPendingInvites(dbClient, rideId) {
    return this.resetPendingInvites(dbClient, rideId);
  }

  static async listRides(filters = {}, dbClient) {
    const executor = getExecutor(dbClient);
    const {
      clientId,
      driverId,
      status,
      limit = 25,
      offset = 0,
      includePassenger = false,
    } = filters;

    const conditions = [];
    const params = [];

    if (clientId) {
      params.push(clientId);
      conditions.push(`client_id = $${params.length}`);
    }

    if (driverId) {
      params.push(driverId);
      conditions.push(`driver_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    params.push(limit);
    const limitIndex = params.length;
    params.push(offset);
    const offsetIndex = params.length;

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const passengerSelect = includePassenger
      ? `,
          c.first_name AS client_first_name,
          c.last_name AS client_last_name,
          c.email AS client_email,
          c.phone_number AS client_phone_number`
      : "";

    const passengerJoin = includePassenger
      ? "LEFT JOIN users c ON c.id = r.client_id"
      : "";

    const { rows } = await executor.query(
      `
        SELECT
          r.*
          ${passengerSelect}
        FROM (
          SELECT ${BASE_RIDE_FIELDS}
          FROM rides
          ${whereClause}
          ORDER BY requested_at DESC, created_at DESC
          LIMIT $${limitIndex}
          OFFSET $${offsetIndex}
        ) r
        ${passengerJoin}
        ORDER BY r.requested_at DESC, r.created_at DESC
      `,
      params
    );

    return rows;
  }

  static async listRidesByTimeoutStatus(status, beforeTimestamp, {
    driverIdRequired = false,
    dbClient,
    limit = 100,
  } = {}) {
    const executor = getExecutor(dbClient);
    const driverClause = driverIdRequired ? "AND driver_id IS NOT NULL" : "";
    const { rows } = await executor.query(
      `
        SELECT ${BASE_RIDE_FIELDS}
        FROM rides
        WHERE status = $1
          AND updated_at <= $2
          ${driverClause}
        ORDER BY updated_at ASC
        LIMIT $3
      `,
      [status, beforeTimestamp, limit]
    );

    return rows;
  }

  static async listPendingDriverTimeoutCandidates(beforeTimestamp, options = {}) {
    return this.listRidesByTimeoutStatus(
      "pending_driver",
      beforeTimestamp,
      options
    );
  }

  static async listDriverAssignedTimeoutCandidates(beforeTimestamp, options = {}) {
    return this.listRidesByTimeoutStatus(
      "driver_assigned",
      beforeTimestamp,
      {
        ...options,
        driverIdRequired: true,
      }
    );
  }

  static async listDriverArrivedNoShowCandidates(beforeTimestamp, options = {}) {
    return this.listRidesByTimeoutStatus(
      "driver_arrived",
      beforeTimestamp,
      {
        ...options,
        driverIdRequired: true,
      }
    );
  }

  static async listActiveRidesByDriverId(driverId, { dbClient } = {}) {
    const executor = getExecutor(dbClient);
    const terminalStatuses = Array.from(TERMINAL_RIDE_STATUSES);
    const { rows } = await executor.query(
      `
        SELECT ${BASE_RIDE_FIELDS}
        FROM rides
        WHERE driver_id = $1
          AND status <> ALL($2::text[])
        ORDER BY updated_at DESC
      `,
      [driverId, terminalStatuses]
    );

    return rows;
  }

  static getPool() {
    return pool;
  }
}

module.exports = RideModel;
