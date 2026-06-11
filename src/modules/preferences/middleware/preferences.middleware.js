const ALLOWED_THEMES = ["light", "dark", "system"];
const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validatePreferencesPatch(req, res, next) {
  const body = req.body || {};
  const patch = {};

  if (!hasOwn(body, "theme") && !hasOwn(body, "language")) {
    return res.status(400).json({
      message: "At least one of theme or language is required.",
    });
  }

  if (hasOwn(body, "theme")) {
    if (typeof body.theme !== "string" || !ALLOWED_THEMES.includes(body.theme)) {
      return res.status(400).json({
        message: `theme must be one of: ${ALLOWED_THEMES.join(", ")}.`,
      });
    }

    patch.theme = body.theme;
  }

  if (hasOwn(body, "language")) {
    if (typeof body.language !== "string" || !LANGUAGE_PATTERN.test(body.language)) {
      return res.status(400).json({
        message: "language must be a BCP 47-style code like en, es, or es-CO.",
      });
    }

    patch.language = body.language;
  }

  req.preferencesPatch = patch;
  next();
}

module.exports = {
  validatePreferencesPatch,
  __private: {
    ALLOWED_THEMES,
    LANGUAGE_PATTERN,
  },
};
