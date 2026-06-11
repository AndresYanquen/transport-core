const { env } = require("./env");

function isLocalhostOrigin(origin) {
  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch (_error) {
    return false;
  }
}

function isAllowedCorsOrigin(origin) {
  const allowedOrigins = env.cors.allowedOrigins || [];
  const allowAllOrigins = allowedOrigins.includes("*");
  const allowLocalhostTemporarily = Boolean(env.cors.allowLocalhostTemporarily);

  return (
    !origin ||
    allowAllOrigins ||
    allowedOrigins.includes(origin) ||
    (allowLocalhostTemporarily && isLocalhostOrigin(origin))
  );
}

const corsOptions = {
  origin: (origin, callback) => {
    callback(null, isAllowedCorsOrigin(origin));
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

module.exports = {
  corsOptions,
  isAllowedCorsOrigin,
  isLocalhostOrigin,
};
