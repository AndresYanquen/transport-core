const fs = require("fs");
const path = require("path");

class MetricsCollector {
  constructor({ logger, enableCsv = false } = {}) {
    this.logger = logger;
    this.enableCsv = enableCsv;
    this.startedAt = Date.now();
    this.counters = new Map();
    this.timings = new Map();
    this.activeRides = new Set();
    this.pendingRideStart = new Map(); // rideId -> ms

    this.csvStream = null;
    if (this.enableCsv) {
      const outDir = path.join(process.cwd(), "simulator", "output");
      fs.mkdirSync(outDir, { recursive: true });
      const csvPath = path.join(outDir, "metrics.csv");
      this.csvStream = fs.createWriteStream(csvPath, { flags: "w" });
      this.csvStream.write("ts,metric,value\n");
    }
  }

  inc(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + by);
    if (this.csvStream) {
      this.csvStream.write(`${Date.now()},${name},${by}\n`);
    }
  }

  observeTiming(name, ms) {
    const entry = this.timings.get(name) || { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += ms;
    this.timings.set(name, entry);
  }

  startAssignmentTimer(rideId) {
    if (!rideId) return;
    this.pendingRideStart.set(rideId, Date.now());
  }

  stopAssignmentTimer(rideId) {
    if (!rideId) return;
    const start = this.pendingRideStart.get(rideId);
    if (!start) return;
    this.pendingRideStart.delete(rideId);
    this.observeTiming("ride_assignment_ms", Date.now() - start);
  }

  setRideActive(rideId) {
    if (!rideId) return;
    this.activeRides.add(rideId);
  }

  setRideInactive(rideId) {
    if (!rideId) return;
    this.activeRides.delete(rideId);
  }

  summary() {
    const uptimeMs = Date.now() - this.startedAt;
    const counters = Object.fromEntries(this.counters.entries());
    const timings = {};
    for (const [k, v] of this.timings.entries()) {
      timings[k] = {
        count: v.count,
        avgMs: v.count ? v.sum / v.count : 0,
      };
    }
    return {
      uptimeMs,
      counters,
      timings,
      activeRides: this.activeRides.size,
    };
  }

  printLive() {
    const s = this.summary();
    const apiAvg = s.timings.api_request_ms?.avgMs
      ? s.timings.api_request_ms.avgMs.toFixed(1)
      : "n/a";
    const assignAvg = s.timings.ride_assignment_ms?.avgMs
      ? s.timings.ride_assignment_ms.avgMs.toFixed(1)
      : "n/a";

    this.logger?.info?.(
      `[METRICS] driversOnline=${s.counters.drivers_online || 0} customersStarted=${
        s.counters.customers_started || 0
      } ridesRequested=${s.counters.rides_requested || 0} ridesCompleted=${
        s.counters.rides_completed || 0
      } ridesCancelled=${s.counters.rides_cancelled || 0} apiErrors=${
        s.counters.api_errors || 0
      } apiAvgMs=${apiAvg} assignAvgMs=${assignAvg} activeRides=${s.activeRides}`
    );
  }

  close() {
    if (this.csvStream) {
      this.csvStream.end();
      this.csvStream = null;
    }
  }
}

module.exports = MetricsCollector;

