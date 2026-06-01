const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const MetricsCollector = require("../simulator/metrics/MetricsCollector");
const { evaluateSimulation } = require("../simulator/metrics/evaluateSimulation");

function baseConfig(overrides = {}) {
  return {
    driverCount: 2,
    customerCount: 2,
    success: {
      maxApiErrors: 0,
      maxApiErrorRate: 0,
      minRidesRequested: 1,
      minRidesCompleted: 1,
      minCompletionRate: 0.5,
      maxAvgApiMs: 2000,
      maxAvgAssignmentMs: 30000,
      ...overrides,
    },
  };
}

test("simulation evaluation passes when metrics meet configured criteria", () => {
  const result = evaluateSimulation({
    config: baseConfig(),
    agentFailures: [],
    summary: {
      counters: {
        api_errors: 0,
        api_requests: 12,
        rides_requested: 2,
        rides_completed: 2,
      },
      timings: {
        api_request_ms: { count: 12, avgMs: 120 },
        ride_assignment_ms: { count: 2, avgMs: 1500 },
      },
      rates: {
        apiErrorRate: 0,
        completionRate: 1,
      },
    },
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.failedChecks, []);
});

test("simulation evaluation fails when errors or ride outcomes violate criteria", () => {
  const result = evaluateSimulation({
    config: baseConfig(),
    agentFailures: [{ scope: "agent", reason: "login failed" }],
    summary: {
      counters: {
        api_errors: 2,
        api_requests: 8,
        rides_requested: 1,
        rides_completed: 0,
      },
      timings: {
        api_request_ms: { count: 8, avgMs: 2500 },
      },
      rates: {
        apiErrorRate: 0.2,
        completionRate: 0,
      },
    },
  });

  assert.equal(result.pass, false);
  assert.deepEqual(
    result.failedChecks.map((check) => check.name),
    ["agent_failures", "api_errors", "api_error_rate", "rides_completed", "completion_rate", "avg_api_ms"]
  );
});

test("metrics collector writes structured backend error report", () => {
  const metrics = new MetricsCollector({ enableErrorReport: true });
  const error = new Error("HTTP 409 POST /api/rides");
  error.status = 409;
  error.method = "POST";
  error.path = "/api/rides";
  error.durationMs = 42;
  error.responseBody = { message: "Client already has an active ride." };

  metrics.recordApiError(error, {
    agentType: "customer",
    agentId: 7,
    phase: "run_once",
    rideId: "ride-1",
  });

  const reportPath = metrics.writeErrorReport(metrics.summary());
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

  assert.equal(report.errorCount, 1);
  assert.equal(report.groups[0].key, "409 POST /api/rides");
  assert.equal(report.errors[0].agentType, "customer");
  assert.equal(report.errors[0].responseBody.message, "Client already has an active ride.");
  assert.equal(metrics.summary().errorReportPath, reportPath);
});
