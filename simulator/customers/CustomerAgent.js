const { sleep } = require("../utils/sleep");
const { chance, randInt } = require("../utils/random");
const { randomLocationAroundCenter } = require("../gps/coordinates");
const SocketClient = require("../core/SocketClient");

class CustomerAgent {
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
    this.currentRideId = null;
    this.socketClient = null;
    this.socket = null;
    this.statusUpdates = []; // queue of ride:status-updated payloads
  }

  email() {
    return this.config.users.customerEmailTemplate.replace("{n}", String(this.id));
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

    this.socket.on("ride:status-updated", (payload) => {
      if (!payload?.rideId) return;
      // Keep a best-effort queue. We'll filter by currentRideId at consumption time.
      this.statusUpdates.push(payload);
    });
  }

  async subscribeRideRoom(rideId) {
    if (!this.config.enableSockets || !this.socketClient) return;
    try {
      await this.socketClient.subscribeRide(rideId, { timeoutMs: 5000 });
    } catch (err) {
      // Don't fail simulation if subscribe is forbidden/missing. We'll fallback to polling.
      this.logger.warn(
        `[CUSTOMER ${this.id}] socket ride:subscribe failed for ${rideId}: ${err.message}`
      );
    }
  }

  buildRideBody() {
    const origin = randomLocationAroundCenter({
      centerLat: this.config.gps.centerLat,
      centerLng: this.config.gps.centerLng,
      radiusKm: this.config.gps.radiusKm,
    });

    const destination = randomLocationAroundCenter({
      centerLat: this.config.gps.centerLat,
      centerLng: this.config.gps.centerLng,
      radiusKm: this.config.gps.radiusKm,
    });

    return {
      pickupAddress: `Origin ${this.id}`,
      pickupLocation: origin,
      dropoffAddress: `Destination ${this.id}`,
      dropoffLocation: destination,
      serviceType: "standard",
      currency: "USD",
    };
  }

  async createRide() {
    const body = this.buildRideBody();
    const startedAt = Date.now();
    const { data, durationMs } = await this.api.post(this.config.endpoints.ridesCreatePath, {
      body,
    });
    this.metrics.inc("rides_requested");
    this.metrics.observeTiming("api_request_ms", durationMs);
    const rideId = data?.ride?.id || data?.ride?.rideId || data?.id;
    if (!rideId) {
      throw new Error("Create ride response missing ride id");
    }
    this.currentRideId = rideId;
    this.metrics.setRideActive(rideId);
    this.metrics.startAssignmentTimer(rideId);
    this.logger.debug(`[CUSTOMER ${this.id}] created ride ${rideId} in ${Date.now() - startedAt}ms`);

    await this.subscribeRideRoom(rideId);
  }

  async cancelRideIfNeeded() {
    if (!this.currentRideId) return false;
    if (!chance(this.config.customerCancelRate)) return false;

    const path = this.config.endpoints.ridesCancelPathTemplate.replace(
      ":rideId",
      this.currentRideId
    );
    try {
      const { durationMs } = await this.api.patch(path, { body: { cancellationReason: "sim" } });
      this.metrics.inc("rides_cancelled");
      this.metrics.observeTiming("api_request_ms", durationMs);
      this.metrics.setRideInactive(this.currentRideId);
      this.logger.info(`[CUSTOMER ${this.id}] cancelled ride ${this.currentRideId}`);
      return true;
    } catch (err) {
      this.metrics.recordApiError(err, {
        agentType: "customer",
        agentId: this.id,
        phase: "cancel_ride",
        rideId: this.currentRideId,
      });
      this.logger.warn(`[CUSTOMER ${this.id}] cancel failed: ${err.message}`);
      return false;
    }
  }

  async pollRideUntilDone() {
    const rideId = this.currentRideId;
    const path = this.config.endpoints.ridesGetPathTemplate.replace(":rideId", rideId);

    while (!this.abortSignal?.aborted) {
      const { data, durationMs } = await this.api.get(path, {
        params: { includeDriver: true, includePassenger: true },
      });
      this.metrics.observeTiming("api_request_ms", durationMs);

      const status = data?.ride?.status || data?.status;
      if (status && status !== "pending_driver") {
        this.metrics.stopAssignmentTimer(rideId);
      }

      if (status === "completed") {
        this.metrics.markRideCompleted(rideId);
        return;
      }

      if (String(status || "").startsWith("canceled") || status === "no_show") {
        this.metrics.setRideInactive(rideId);
        return;
      }

      if (status === "pending_driver") {
        await this.cancelRideIfNeeded();
      }

      await sleep(this.config.ridePollIntervalMs, this.abortSignal);
    }
  }

  async waitForRideWithSocketFallback() {
    const rideId = this.currentRideId;
    const path = this.config.endpoints.ridesGetPathTemplate.replace(":rideId", rideId);

    let lastHttpSyncAt = 0;
    const httpSync = async () => {
      lastHttpSyncAt = Date.now();
      const { data, durationMs } = await this.api.get(path, {
        params: { includeDriver: true, includePassenger: true },
      });
      this.metrics.observeTiming("api_request_ms", durationMs);
      const status = data?.ride?.status || data?.status;
      return status;
    };

    // Initial sync to prime status (and stop assignment timer early if needed).
    let status = await httpSync();

    while (!this.abortSignal?.aborted) {
      // Drain socket updates first.
      while (this.statusUpdates.length > 0) {
        const payload = this.statusUpdates.shift();
        if (payload?.rideId !== rideId) continue;
        status = payload?.ride?.status || payload?.status || status;
      }

      if (status && status !== "pending_driver") {
        this.metrics.stopAssignmentTimer(rideId);
      }

      if (status === "completed") {
        this.metrics.markRideCompleted(rideId);
        return;
      }

      if (String(status || "").startsWith("canceled") || status === "no_show") {
        this.metrics.setRideInactive(rideId);
        return;
      }

      if (status === "pending_driver") {
        await this.cancelRideIfNeeded();
      }

      // If sockets are enabled but backend didn't emit events, periodically resync via HTTP.
      if (Date.now() - lastHttpSyncAt >= this.config.ridePollIntervalMs) {
        try {
          status = await httpSync();
        } catch (err) {
          if (this.abortSignal?.aborted || err?.code === "ABORT_ERR" || err?.message === "Aborted") {
            return;
          }
          this.metrics.recordApiError(err, {
            agentType: "customer",
            agentId: this.id,
            phase: "ride_sync",
            rideId,
          });
          this.logger.warn(`[CUSTOMER ${this.id}] ride sync failed: ${err.message}`);
        }
      }

      await sleep(200, this.abortSignal);
    }
  }

  async runOnce() {
    await sleep(randInt(0, 2000), this.abortSignal);
    await this.createRide();
    if (this.config.enableSockets) {
      await this.waitForRideWithSocketFallback();
    } else {
      await this.pollRideUntilDone();
    }
    this.currentRideId = null;
  }

  async run() {
    await this.login();
    this.connectSocket();
    this.metrics.inc("customers_started");

    try {
      while (!this.abortSignal?.aborted) {
        try {
          await this.runOnce();
        } catch (err) {
          if (this.abortSignal?.aborted || err?.code === "ABORT_ERR" || err?.message === "Aborted") {
            break;
          }
          this.metrics.recordApiError(err, {
            agentType: "customer",
            agentId: this.id,
            phase: "run_once",
            rideId: this.currentRideId,
          });
          this.logger.warn(`[CUSTOMER ${this.id}] error: ${err.message}`);
          await sleep(1000, this.abortSignal);
        }

        // Spread customer demand.
        await sleep(this.config.customerRequestIntervalMs, this.abortSignal);
      }
    } finally {
      this.socketClient?.disconnect?.();
    }
  }
}

module.exports = CustomerAgent;
