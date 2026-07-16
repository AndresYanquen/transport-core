const REQUEST_STATUSES = ["pending", "accepted", "rejected", "canceled", "expired"];
const REQUEST_PRIORITIES = ["normal", "active_ride", "emergency"];
const SESSION_STATUSES = [
  "connecting",
  "idle",
  "operator_speaking",
  "driver_replying",
  "ended",
  "failed",
];
const TERMINAL_SESSION_STATUSES = new Set(["ended", "failed"]);

module.exports = {
  REQUEST_STATUSES,
  REQUEST_PRIORITIES,
  SESSION_STATUSES,
  TERMINAL_SESSION_STATUSES,
};
