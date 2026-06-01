const fs = require("fs");
const path = require("path");

class MetricsCollector {
  constructor({ logger, enableCsv = false, enableErrorReport = true } = {}) {
    this.logger = logger;
    this.enableCsv = enableCsv;
    this.enableErrorReport = enableErrorReport;
    this.startedAt = Date.now();
    this.counters = new Map();
    this.timings = new Map();
    this.activeRides = new Set();
    this.completedRides = new Set();
    this.pendingRideStart = new Map(); // rideId -> ms
    this.errors = [];
    this.errorGroups = new Map();
    this.outputDir = path.join(process.cwd(), "simulator", "output");
    this.errorReportPath = null;

    this.csvStream = null;
    if (this.enableCsv) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      const csvPath = path.join(this.outputDir, "metrics.csv");
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
    if (name === "api_request_ms") {
      this.inc("api_requests");
    }
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

  markRideCompleted(rideId) {
    if (!rideId || this.completedRides.has(rideId)) return;
    this.completedRides.add(rideId);
    this.inc("rides_completed");
    this.setRideInactive(rideId);
  }

  recordApiError(error, context = {}) {
    this.inc("api_errors");

    const entry = this.buildErrorEntry(error, context);
    this.errors.push(entry);

    const groupKey = [
      entry.status || "NO_STATUS",
      entry.method || "UNKNOWN_METHOD",
      entry.path || "UNKNOWN_PATH",
    ].join(" ");
    const group = this.errorGroups.get(groupKey) || {
      key: groupKey,
      count: 0,
      status: entry.status,
      method: entry.method,
      path: entry.path,
      firstSeenAt: entry.occurredAt,
      lastSeenAt: entry.occurredAt,
      samples: [],
    };
    group.count += 1;
    group.lastSeenAt = entry.occurredAt;
    if (group.samples.length < 5) {
      group.samples.push(entry);
    }
    this.errorGroups.set(groupKey, group);

    return entry;
  }

  buildErrorEntry(error, context = {}) {
    const responseData = error?.responseBody ?? error?.response?.data ?? null;
    return {
      occurredAt: new Date().toISOString(),
      agentType: context.agentType || null,
      agentId: context.agentId ?? null,
      phase: context.phase || null,
      rideId: context.rideId || null,
      status: error?.status ?? error?.response?.status ?? null,
      method: error?.method || context.method || error?.config?.method || null,
      path: error?.path || context.path || error?.config?.url || null,
      url: error?.url || null,
      durationMs: error?.durationMs ?? null,
      code: error?.code || null,
      message: error?.message || String(error),
      responseBody: sanitizeForJson(responseData),
    };
  }

  writeErrorReport(finalSummary = null) {
    if (!this.enableErrorReport) return null;

    fs.mkdirSync(this.outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.errorReportPath = path.join(this.outputDir, `errors-${stamp}.json`);

    const report = {
      generatedAt: new Date().toISOString(),
      summary: finalSummary || this.summary(),
      errorCount: this.errors.length,
      groups: Array.from(this.errorGroups.values()).sort((a, b) => b.count - a.count),
      errors: this.errors,
    };

    fs.writeFileSync(this.errorReportPath, `${JSON.stringify(report, null, 2)}\n`);
    return this.errorReportPath;
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
      errorReportPath: this.errorReportPath,
      rates: {
        completionRate:
          counters.rides_requested > 0
            ? (counters.rides_completed || 0) / counters.rides_requested
            : 0,
        apiErrorRate:
          (counters.api_requests || 0) + (counters.api_errors || 0) > 0
            ? (counters.api_errors || 0) /
              ((counters.api_requests || 0) + (counters.api_errors || 0))
            : 0,
      },
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

function sanitizeForJson(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.slice(0, 2000);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value).slice(0, 2000);
  }
}

module.exports = MetricsCollector;
