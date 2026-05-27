function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error("Aborted"));
    }

    const timer = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        },
        { once: true }
      );
    }
  });
}

module.exports = {
  sleep,
};

