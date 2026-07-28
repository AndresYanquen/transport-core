const { env } = require("../../../config");
const RadioService = require("./radio.service");

let timer;
let running = false;

async function sweep() {
  if (running) return;
  running = true;
  try { await RadioService.sweep(); }
  catch (error) { console.error("Radio timeout sweep failed:", error); }
  finally { running = false; }
}

function startRadioWorker() {
  if (timer) return;
  timer = setInterval(sweep, Math.max(5, env.radio.sweepIntervalSeconds) * 1000);
  timer.unref();
}

function stopRadioWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { startRadioWorker, stopRadioWorker, sweep };
