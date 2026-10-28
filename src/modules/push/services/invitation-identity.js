function invitationEventId(invite) {
  if (!invite?.id || !invite.invitedAt) return null;
  const timestamp = new Date(invite.invitedAt);
  if (!Number.isFinite(timestamp.getTime())) return null;
  return `invite:${invite.id}:${timestamp.toISOString()}`;
}
module.exports = { invitationEventId };
