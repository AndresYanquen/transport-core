const { query } = require("../../../config/database");
const { env } = require("../../../config");

function mapPointGeoJSON(pointGeojson) {
  if (!pointGeojson || pointGeojson.type !== "Point") return null;
  const coords = pointGeojson.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return { lat: coords[1], lng: coords[0] };
}

function toIso(v) {
  if (!v) return null;
  try {
    return new Date(v).toISOString();
  } catch {
    return null;
  }
}

function buildTimeFilter({ column, from, to, startIndex }) {
  const clauses = [];
  const values = [];
  let paramIndex = startIndex;

  if (from) {
    clauses.push(`${column} >= $${paramIndex}`);
    values.push(from);
    paramIndex += 1;
  }

  if (to) {
    clauses.push(`${column} <= $${paramIndex}`);
    values.push(to);
    paramIndex += 1;
  }

  return {
    clause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
    nextIndex: paramIndex,
  };
}

async function getSimulationState({ limit = 200, from = null, to = null } = {}) {
  const now = new Date();
  const driversTimeFilter = buildTimeFilter({
    column: "d.updated_at",
    from,
    to,
    startIndex: 1,
  });
  const ridesTimeFilter = buildTimeFilter({
    column: "r.requested_at",
    from,
    to,
    startIndex: 2,
  });
  const eventsTimeFilter = buildTimeFilter({
    column: "e.occurred_at",
    from,
    to,
    startIndex: 2,
  });

  // Driver snapshot, enriched with "currentRideId" if driver has any non-terminal ride.
  const driversSql = `
    SELECT
      d.user_id,
      d.status,
      d.availability_intent,
      d.last_seen_at,
      d.offline_reason,
      d.updated_at,
      ST_AsGeoJSON(d.current_location)::json AS current_location_geojson,
      u.email,
      u.first_name,
      u.last_name,
      (
        SELECT r.id
        FROM rides r
        WHERE r.driver_id = d.user_id
          AND r.status NOT IN ('completed', 'canceled_by_client', 'canceled_by_driver', 'canceled_by_system', 'no_show')
        ORDER BY r.updated_at DESC
        LIMIT 1
      ) AS current_ride_id
    FROM drivers d
    JOIN users u ON u.id = d.user_id
    ${driversTimeFilter.clause}
    ORDER BY d.updated_at DESC
    LIMIT 2000
  `;

  const ridesSql = `
    SELECT
      r.*,
      ST_AsGeoJSON(r.pickup_point)::json AS pickup_point_geojson,
      ST_AsGeoJSON(r.dropoff_point)::json AS dropoff_point_geojson,
      uc.email AS client_email,
      uc.first_name AS client_first_name,
      uc.last_name AS client_last_name,
      ud.email AS driver_email,
      ud.first_name AS driver_first_name,
      ud.last_name AS driver_last_name
    FROM rides r
    JOIN users uc ON uc.id = r.client_id
    LEFT JOIN users ud ON ud.id = r.driver_id
    ${ridesTimeFilter.clause}
    ORDER BY r.requested_at DESC
    LIMIT $1
  `;

  const rideEventsSql = `
    SELECT
      e.id,
      e.ride_id,
      e.status,
      e.actor_type,
      e.actor_id,
      e.payload,
      e.occurred_at
    FROM ride_events e
    ${eventsTimeFilter.clause}
    ORDER BY e.occurred_at DESC
    LIMIT $1
  `;

  const [driversRes, ridesRes, eventsRes] = await Promise.all([
    query(driversSql, driversTimeFilter.values),
    query(ridesSql, [limit, ...ridesTimeFilter.values]),
    query(rideEventsSql, [Math.min(500, limit), ...eventsTimeFilter.values]),
  ]);

  const drivers = (driversRes.rows || []).map((row) => {
    const currentLocation = mapPointGeoJSON(row.current_location_geojson);
    const status = row.status;
    const email = row.email || "";
    const isSimUser =
      /^driver\d+@test\.com$/i.test(email) || /^customer\d+@test\.com$/i.test(email);

    return {
      userId: row.user_id,
      status,
      availabilityIntent: row.availability_intent,
      lastSeenAt: toIso(row.last_seen_at),
      offlineReason: row.offline_reason,
      updatedAt: toIso(row.updated_at),
      currentLocation,
      currentRideId: row.current_ride_id || null,
      contact: {
        email,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
      },
      isSimUser,
    };
  });

  const rides = (ridesRes.rows || []).map((row) => {
    const pickupLocation = mapPointGeoJSON(row.pickup_point_geojson);
    const dropoffLocation = mapPointGeoJSON(row.dropoff_point_geojson);
    return {
      id: row.id,
      status: row.status,
      serviceType: row.service_type,
      currency: row.currency,
      requestedAt: toIso(row.requested_at),
      acceptedAt: toIso(row.accepted_at),
      driverArrivedAt: toIso(row.driver_arrived_at),
      startedAt: toIso(row.started_at),
      completedAt: toIso(row.completed_at),
      canceledAt: toIso(row.canceled_at),
      updatedAt: toIso(row.updated_at),
      clientId: row.client_id,
      driverId: row.driver_id,
      pickupAddress: row.pickup_address,
      dropoffAddress: row.dropoff_address,
      hasDestination: Boolean(row.has_destination),
      pickupLocation,
      dropoffLocation,
      finalFareAmount: row.final_fare_amount !== null ? Number(row.final_fare_amount) : null,
      estimatedFareAmount:
        row.estimated_fare_amount !== null ? Number(row.estimated_fare_amount) : null,
      client: {
        email: row.client_email,
        firstName: row.client_first_name,
        lastName: row.client_last_name,
      },
      driver: row.driver_id
        ? {
            email: row.driver_email,
            firstName: row.driver_first_name,
            lastName: row.driver_last_name,
          }
        : null,
    };
  });

  const recentEvents = (eventsRes.rows || []).map((row) => ({
    id: row.id,
    rideId: row.ride_id,
    status: row.status,
    actorType: row.actor_type,
    actorId: row.actor_id,
    payload: row.payload || {},
    occurredAt: toIso(row.occurred_at),
  }));

  const driverTotal = drivers.length;
  const driverBusy = drivers.filter((d) => d.status === "busy" || d.currentRideId).length;
  const driverAvailable = drivers.filter((d) => d.status === "online" && !d.currentRideId).length;
  const driverOnline = driverAvailable + driverBusy;
  const driverOffline = drivers.filter((d) => d.status === "offline").length;

  const rideCounts = {};
  for (const ride of rides) {
    rideCounts[ride.status] = (rideCounts[ride.status] || 0) + 1;
  }

  // "GPS updates per minute": we don't have a raw counter, approximate as number of drivers updated in last minute.
  const gpsUpdatesLastMinute = drivers.filter((d) => {
    if (!d.currentLocation) return false;
    if (!d.updatedAt) return false;
    return new Date(d.updatedAt).getTime() >= Date.now() - 60_000;
  }).length;

  // Avg assignment time (requested_at -> accepted_at) for rides with accepted_at in the returned window.
  let assignSum = 0;
  let assignCount = 0;
  for (const ride of rides) {
    if (!ride.requestedAt || !ride.acceptedAt) continue;
    const ms = new Date(ride.acceptedAt).getTime() - new Date(ride.requestedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0 && ms <= 1000 * 60 * 60) {
      assignSum += ms;
      assignCount += 1;
    }
  }
  const avgAssignmentMs = assignCount ? Math.round(assignSum / assignCount) : null;

  // Simulation-ish indicators from email patterns.
  const simDrivers = drivers.filter((d) => /^driver\d+@test\.com$/i.test(d.contact.email)).length;
  const simCustomers = rides.filter((r) => /^customer\d+@test\.com$/i.test(r.client.email)).length;

  return {
    server: {
      now: now.toISOString(),
      realtimeEnabled: Boolean(env.realtime.enabled),
    },
    metrics: {
      drivers: {
        total: driverTotal,
        online: driverOnline,
        offline: driverOffline,
        available: driverAvailable,
        busy: driverBusy,
      },
      customers: {
        // We don't track connected customers in backend; expose approximation for simulation.
        simulatedInWindow: simCustomers,
      },
      rides: {
        counts: rideCounts,
        avgAssignmentMs,
      },
      gps: {
        updatesLastMinute: gpsUpdatesLastMinute,
      },
      errors: {
        apiErrors: null,
      },
      simulation: {
        running: null,
        simulatedDrivers: simDrivers,
        chaosMode: null,
      },
    },
    drivers,
    rides,
    recentEvents,
  };
}

module.exports = {
  getSimulationState,
};
