function evaluateSimulation({ summary, config, agentFailures = [] }) {
  const counters = summary.counters || {};
  const timings = summary.timings || {};
  const rates = summary.rates || {};
  const criteria = config.success || {};

  const expectedRequested =
    criteria.minRidesRequested ?? (config.customerCount > 0 ? 1 : 0);
  const expectedCompleted =
    criteria.minRidesCompleted ?? (config.customerCount > 0 && config.driverCount > 0 ? 1 : 0);

  const checks = [
    {
      name: "agent_failures",
      pass: agentFailures.length === 0,
      actual: agentFailures.length,
      expected: 0,
    },
    {
      name: "api_errors",
      pass: (counters.api_errors || 0) <= criteria.maxApiErrors,
      actual: counters.api_errors || 0,
      expected: `<= ${criteria.maxApiErrors}`,
    },
    {
      name: "api_error_rate",
      pass: rates.apiErrorRate <= criteria.maxApiErrorRate,
      actual: rates.apiErrorRate,
      expected: `<= ${criteria.maxApiErrorRate}`,
    },
    {
      name: "rides_requested",
      pass: (counters.rides_requested || 0) >= expectedRequested,
      actual: counters.rides_requested || 0,
      expected: `>= ${expectedRequested}`,
    },
    {
      name: "rides_completed",
      pass: (counters.rides_completed || 0) >= expectedCompleted,
      actual: counters.rides_completed || 0,
      expected: `>= ${expectedCompleted}`,
    },
    {
      name: "completion_rate",
      pass: rates.completionRate >= criteria.minCompletionRate,
      actual: rates.completionRate,
      expected: `>= ${criteria.minCompletionRate}`,
    },
    {
      name: "avg_api_ms",
      pass:
        !timings.api_request_ms?.count ||
        timings.api_request_ms.avgMs <= criteria.maxAvgApiMs,
      actual: timings.api_request_ms?.avgMs ?? null,
      expected: `<= ${criteria.maxAvgApiMs}`,
    },
    {
      name: "avg_assignment_ms",
      pass:
        !timings.ride_assignment_ms?.count ||
        timings.ride_assignment_ms.avgMs <= criteria.maxAvgAssignmentMs,
      actual: timings.ride_assignment_ms?.avgMs ?? null,
      expected: `<= ${criteria.maxAvgAssignmentMs}`,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
    failedChecks: checks.filter((check) => !check.pass),
  };
}

module.exports = {
  evaluateSimulation,
};
