const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateDriverId(req, res, next) {
  const driverId = req.params.driverId || req.body?.driverId;

  if (!UUID_PATTERN.test(String(driverId || ""))) {
    return res.status(400).json({ message: "driverId must be a valid UUID." });
  }

  req.preferredDriverId = driverId;
  next();
}

function validateListQuery(req, res, next) {
  const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ message: "limit must be an integer from 1 to 100." });
  }

  req.preferredDriverQuery = { limit };
  next();
}

module.exports = {
  validateDriverId,
  validateListQuery,
  __private: {
    UUID_PATTERN,
  },
};
