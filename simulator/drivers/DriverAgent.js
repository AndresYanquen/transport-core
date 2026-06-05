const { sleep } = require("../utils/sleep");
const { chance, randInt } = require("../utils/random");
const { randomLocationAroundCenter, calculateDistanceKm } = require("../gps/coordinates");
const { buildMovementPlan, moveWithNoise } = require("../gps/movement");
const SocketClient = require("../core/SocketClient");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class DriverAgent {
  constructor({ id, config, apiClient, authClient, metrics, logger, abortSignal }) {
    this.id = id;
    this.config = config;
    this.api = apiClient;
    this.auth = authClient;
    this.metrics = metrics;
    this.logger = logger;
    this.abortSignal = abortSignal;

    this.user = null;
    this.token = null;
    this.location = null;
    this.socketClient = null;
    this.socket = null;
    this.pendingInvites = [];
    this.rideStatus = new Map(); // rideId -> status
  }

  email() {
    return this.config.users.driverEmailTemplate.replace("{n}", String(this.id));
  }

  async login() {
    const session = await this.auth.login({ email: this.email() });
    this.user = session.user;
    this.token = session.token;
    this.api.setToken(this.token);
  }

  connectSocket() {
    if (!this.config.enableSockets) return;
    this.socketClient = new SocketClient({
      socketUrl: this.config.socketUrl,
      path: this.config.socket.path,
      logger: this.logger,
    });
    this.socket = this.socketClient.connect({ token: this.token });

    this.socket.on("ride:invite-created", (payload) => {
      const invite = payload?.invite;
      if (!invite) return;
      this.pendingInvites.push(invite);
    });

    this.socket.on("ride:invites-updated", (payload) => {
      const invites = payload?.invites;
      if (Array.isArray(invites)) {
        this.pendingInvites = invites;
      }
    });

    this.socket.on("ride:invite-responded", () => {
      // driver response will re-fetch ride if accepted; keep queue best-effort
    });

    this.socket.on("ride:status-updated", (payload) => {
      const rideId = payload?.rideId;
      const status = payload?.ride?.status;
      if (!rideId || !status) return;
      this.rideStatus.set(rideId, status);
    });
  }

  async subscribeRideRoom(rideId) {
    if (!this.config.enableSockets || !this.socketClient) return;
    try {
      await this.socketClient.subscribeRide(rideId, { timeoutMs: 10000 });
    } catch (err) {
      this.logger.warn(`[DRIVER ${this.id}] socket ride:subscribe failed for ${rideId}: ${err.message}`);
    }
  }

  async setOnline() {
    const path = this.config.endpoints.driverStatusPathTemplate.replace(
      ":driverId",
      this.user.id
    );
    const { durationMs } = await this.api.patch(path, { body: { status: "online" } });
    this.metrics.observeTiming("api_request_ms", durationMs);
    this.metrics.inc("drivers_online");
  }

  async updateLocation() {
    const path = this.config.endpoints.driverLocationPathTemplate.replace(
      ":driverId",
      this.user.id
    );
    const { durationMs } = await this.api.patch(path, {
      body: { currentLocation: this.location, heading: randInt(0, 359), speedKmh: randInt(5, 45) },
    });
    this.metrics.observeTiming("api_request_ms", durationMs);
    this.metrics.inc("gps_updates_sent");
  }

  async pollInvites() {
    const { data, durationMs } = await this.api.get(this.config.endpoints.driverInvitesPath, {
      params: { statuses: "pending", limit: 10 },
    });
    this.metrics.observeTiming("api_request_ms", durationMs);
    return data?.invites || [];
  }

  async waitForInviteOrTimeout(timeoutMs) {
    const started = Date.now();
    while (!this.abortSignal?.aborted) {
      if (this.pendingInvites.length > 0) {
        return this.pendingInvites.shift();
      }
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        return null;
      }
      await sleep(200, this.abortSignal);
    }
    return null;
  }

  async respondToInvite(invite) {
    const rideId = invite.rideId || invite.ride_id || invite.ride?.id;
    if (!rideId) return null;

    const accept = chance(this.config.driverAcceptanceRate);
    const action = accept ? "accept" : "reject";
    const path = this.config.endpoints.driverResponsePathTemplate.replace(":rideId", rideId);
    const { data, durationMs } = await this.api.patch(path, {
      body: { action },
    });
    this.metrics.observeTiming("api_request_ms", durationMs);

    if (data?.ignored) {
      this.metrics.inc("rides_response_ignored");
      this.pendingInvites = this.pendingInvites.filter((pending) => {
        const pendingRideId = pending.rideId || pending.ride_id || pending.ride?.id;
        return pendingRideId !== rideId;
      });
      return null;
    }

    const assignedDriverId = data?.ride?.driverId || data?.ride?.driver_id;
    if (accept && assignedDriverId && assignedDriverId !== this.user?.id) {
      this.metrics.inc("rides_response_ignored");
      this.logger.warn(
        `[DRIVER ${this.id}] accepted invite ${rideId} but ride is assigned to ${assignedDriverId}`
      );
      return null;
    }

    this.metrics.inc(accept ? "rides_accepted" : "rides_rejected");
    if (accept) {
      await this.subscribeRideRoom(rideId);
    }
    return accept ? rideId : null;
  }

  async getRide(rideId) {
    const path = this.config.endpoints.ridesGetPathTemplate.replace(":rideId", rideId);
    const { data, durationMs } = await this.api.get(path, {
      params: { includeDriver: true, includePassenger: true },
    });
    this.metrics.observeTiming("api_request_ms", durationMs);
    return data?.ride || data;
  }

  async driverProgress(rideId, status, extra = {}) {
    const path = this.config.endpoints.driverProgressPathTemplate.replace(":rideId", rideId);
    const { durationMs } = await this.api.patch(path, {
      body: { status, ...extra },
    });
    this.metrics.observeTiming("api_request_ms", durationMs);
  }

  async simulateRide(rideId) {
    const ride = await this.getRide(rideId);
    const pickup = ride?.pickupLocation;
    const dropoff = ride?.dropoffLocation;

    if (pickup) {
      const km = calculateDistanceKm(this.location, pickup);
      const steps = Math.max(10, Math.min(60, Math.floor(km * 10)));
      const plan = buildMovementPlan({ start: this.location, end: pickup, steps });
      await this.driverProgress(rideId, "driver_en_route");
      for (;;) {
        if (this.abortSignal?.aborted) return;
        const status = this.rideStatus.get(rideId);
        if (status && (String(status).startsWith("canceled") || status === "no_show")) {
          this.metrics.setRideInactive?.(rideId);
          return;
        }
        const { done, location } = plan.next();
        this.location = moveWithNoise(location);
        await this.updateLocation();
        if (done) break;
        await sleep(this.config.gpsIntervalMs / 3, this.abortSignal);
      }
      await this.driverProgress(rideId, "driver_arrived");
      await sleep(randInt(1000, 4000), this.abortSignal);
      await this.driverProgress(rideId, "in_progress");
    }

    if (dropoff) {
      const km = calculateDistanceKm(this.location, dropoff);
      const steps = Math.max(10, Math.min(80, Math.floor(km * 12)));
      const plan = buildMovementPlan({ start: this.location, end: dropoff, steps });
      for (;;) {
        if (this.abortSignal?.aborted) return;
        const status = this.rideStatus.get(rideId);
        if (status && (String(status).startsWith("canceled") || status === "no_show")) {
          this.metrics.setRideInactive?.(rideId);
          return;
        }
        const { done, location } = plan.next();
        this.location = moveWithNoise(location);
        await this.updateLocation();
        if (done) break;
        await sleep(this.config.gpsIntervalMs / 3, this.abortSignal);
      }
    }

    await this.driverProgress(rideId, "completed", {
      actualDistanceMeters: randInt(800, 6000),
      actualDurationSeconds: randInt(240, 1800),
      finalFareAmount: Number((randInt(8, 45) + Math.random()).toFixed(2)),
    });
    this.metrics.markRideCompleted(rideId);
  }

  async run() {
    await this.login();
    this.connectSocket();
    this.location = randomLocationAroundCenter({
      centerLat: this.config.gps.centerLat,
      centerLng: this.config.gps.centerLng,
      radiusKm: this.config.gps.radiusKm,
    });

    await this.setOnline();
    await this.updateLocation();

    try {
      while (!this.abortSignal?.aborted) {
        try {
          let invite = null;
          if (this.config.enableSockets) {
            invite = await this.waitForInviteOrTimeout(this.config.gpsIntervalMs);
          } else {
            const invites = await this.pollInvites();
            invite = invites[0] || null;
          }

          if (invite) {
            const rideId = await this.respondToInvite(invite);
            if (rideId) {
              await this.simulateRide(rideId);
            }
          } else {
            // idle GPS updates
            await sleep(this.config.gpsIntervalMs, this.abortSignal);
            this.location = moveWithNoise(this.location);
            await this.updateLocation();
          }
        } catch (err) {
          if (this.abortSignal?.aborted || err?.code === "ABORT_ERR" || err?.message === "Aborted") {
            break;
          }
          this.metrics.recordApiError(err, {
            agentType: "driver",
            agentId: this.id,
            phase: "run_loop",
          });
          this.logger.warn(`[DRIVER ${this.id}] error: ${err.message}`);
          await sleep(1000, this.abortSignal);
        }
      }
    } finally {
      this.socketClient?.disconnect?.();
    }
  }
}

module.exports = DriverAgent;
