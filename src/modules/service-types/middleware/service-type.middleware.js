const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,49}$/;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function validateCodeParam(req, res, next) {
  const { code } = req.params;

  if (!CODE_PATTERN.test(String(code || ""))) {
    return res.status(400).json({
      message:
        "code must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens.",
    });
  }

  req.serviceTypeCode = code;
  next();
}

function validateListQuery(req, res, next) {
  req.serviceTypeQuery = {
    includeInactive: req.query.includeInactive === "true",
  };
  next();
}

function validateCreateServiceType(req, res, next) {
  const body = req.body || {};

  if (!isNonBlankString(body.code) || !CODE_PATTERN.test(body.code.trim())) {
    return res.status(400).json({
      message:
        "code is required and must contain only lowercase letters, numbers, underscores, or hyphens.",
    });
  }

  if (!isNonBlankString(body.name)) {
    return res.status(400).json({ message: "name is required." });
  }

  if (
    hasOwn(body, "description") &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return res.status(400).json({
      message: "description must be a string or null when provided.",
    });
  }

  if (hasOwn(body, "icon") && body.icon !== null && typeof body.icon !== "string") {
    return res.status(400).json({
      message: "icon must be a string or null when provided.",
    });
  }

  const basePrice = hasOwn(body, "basePrice") ? parseMoney(body.basePrice) : 0;
  if (basePrice === null || basePrice < 0) {
    return res.status(400).json({ message: "basePrice must be a nonnegative number." });
  }

  if (hasOwn(body, "isActive") && typeof body.isActive !== "boolean") {
    return res.status(400).json({ message: "isActive must be a boolean." });
  }

  const sortOrder = hasOwn(body, "sortOrder") ? parseInteger(body.sortOrder) : 0;
  if (sortOrder === null) {
    return res.status(400).json({ message: "sortOrder must be an integer." });
  }

  req.serviceTypePayload = {
    code: body.code.trim(),
    name: body.name.trim(),
    description: hasOwn(body, "description") ? body.description?.trim() || null : null,
    icon: hasOwn(body, "icon") ? body.icon?.trim() || null : null,
    basePrice,
    isActive: hasOwn(body, "isActive") ? body.isActive : true,
    sortOrder,
  };
  next();
}

function validateUpdateServiceType(req, res, next) {
  const body = req.body || {};
  const payload = {};

  if (hasOwn(body, "name")) {
    if (!isNonBlankString(body.name)) {
      return res.status(400).json({ message: "name must be a non-empty string." });
    }
    payload.name = body.name.trim();
  }

  if (hasOwn(body, "description")) {
    if (body.description !== null && typeof body.description !== "string") {
      return res.status(400).json({
        message: "description must be a string or null.",
      });
    }
    payload.hasDescription = true;
    payload.description = body.description?.trim() || null;
  }

  if (hasOwn(body, "icon")) {
    if (body.icon !== null && typeof body.icon !== "string") {
      return res.status(400).json({ message: "icon must be a string or null." });
    }
    payload.hasIcon = true;
    payload.icon = body.icon?.trim() || null;
  }

  if (hasOwn(body, "basePrice")) {
    const basePrice = parseMoney(body.basePrice);
    if (basePrice === null || basePrice < 0) {
      return res.status(400).json({
        message: "basePrice must be a nonnegative number.",
      });
    }
    payload.basePrice = basePrice;
  }

  if (hasOwn(body, "isActive")) {
    if (typeof body.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean." });
    }
    payload.isActive = body.isActive;
  }

  if (hasOwn(body, "sortOrder")) {
    const sortOrder = parseInteger(body.sortOrder);
    if (sortOrder === null) {
      return res.status(400).json({ message: "sortOrder must be an integer." });
    }
    payload.sortOrder = sortOrder;
  }

  if (!Object.keys(payload).length) {
    return res.status(400).json({
      message:
        "At least one of name, description, icon, basePrice, isActive, or sortOrder is required.",
    });
  }

  payload.hasDescription = Boolean(payload.hasDescription);
  payload.hasIcon = Boolean(payload.hasIcon);

  req.serviceTypePayload = payload;
  next();
}

module.exports = {
  validateCodeParam,
  validateListQuery,
  validateCreateServiceType,
  validateUpdateServiceType,
  __private: {
    CODE_PATTERN,
  },
};
