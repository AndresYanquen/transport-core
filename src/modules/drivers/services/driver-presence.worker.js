const { env } = require("../../../config");
const DriverService = require("./driver.service");

let timer = null;
let running = false;

async function sweep() {
  if (running) return;
  running = true;
  try {
    const expiredDriverIds = await DriverService.expireStaleOnlineDrivers();
    if (expiredDriverIds.length) {
      console.log(`Marked ${expiredDriverIds.length} stale driver(s) offline.`);
    }
  } catch (error) {
    console.error("Driver presence sweep failed:", error);
  } finally {
    running = false;
  }
}

function startDriverPresenceWorker() {
  if (timer) return;
  const intervalMs = Math.max(5, env.driverPresence.sweepIntervalSeconds) * 1000;
  timer = setInterval(sweep, intervalMs);
  timer.unref();
}

function stopDriverPresenceWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { startDriverPresenceWorker, stopDriverPresenceWorker, sweep };
