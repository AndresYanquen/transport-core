const RideInviteStatus = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
});

const RIDE_INVITE_STATUS_VALUES = Object.values(RideInviteStatus);

module.exports = {
  RideInviteStatus,
  RIDE_INVITE_STATUS_VALUES,
};
