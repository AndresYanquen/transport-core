const levels = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

function createLogger({ level = "info", prefix = "" } = {}) {
  const threshold = levels[level] ?? levels.info;

  function fmt(args) {
    const p = prefix ? `${prefix} ` : "";
    return [p, ...args].join("");
  }

  function logAt(name, args) {
    if ((levels[name] ?? 0) < threshold) return;
    const line = fmt(args);
    // eslint-disable-next-line no-console
    console[name === "debug" ? "log" : name](line);
  }

  return {
    debug: (...args) => logAt("debug", args),
    info: (...args) => logAt("info", args),
    warn: (...args) => logAt("warn", args),
    error: (...args) => logAt("error", args),
    child: (childPrefix) =>
      createLogger({
        level,
        prefix: prefix ? `${prefix} ${childPrefix}` : childPrefix,
      }),
  };
}

module.exports = {
  createLogger,
};

