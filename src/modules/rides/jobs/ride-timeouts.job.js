const { processRideTimeouts } = require("../services/ride-jobs.service");

async function runRideTimeoutSweep(options = {}) {
  return processRideTimeouts(options);
}

module.exports = {
  runRideTimeoutSweep,
};
