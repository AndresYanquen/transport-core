const axios = require("axios");

function isTransientError(error) {
  const status = error?.response?.status;
  if (!status) return true;
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("Aborted"));
        },
        { once: true }
      );
    }
  });
}

class ApiClient {
  constructor({ baseUrl, timeoutMs = 10_000, maxRetries = 2, logger, abortSignal = null }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.logger = logger;
    this.token = null;
    this.abortSignal = abortSignal;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeoutMs,
      validateStatus: () => true,
      headers: {
        Accept: "application/json",
      },
    });
  }

  setToken(token) {
    this.token = token;
  }

  async request(method, path, { params, body, headers, signal } = {}) {
    const start = Date.now();
    let attempt = 0;
    const requestSignal = signal || this.abortSignal || null;

    while (true) {
      if (requestSignal?.aborted) {
        const err = new Error("Aborted");
        err.code = "ABORT_ERR";
        throw err;
      }

      attempt += 1;
      try {
        const res = await this.http.request({
          method,
          url: path,
          params,
          data: body,
          signal: requestSignal || undefined,
          headers: {
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...(headers || {}),
          },
        });

        const ms = Date.now() - start;
        const ok = res.status >= 200 && res.status < 300;

        if (!ok) {
          const err = new Error(
            `HTTP ${res.status} ${method.toUpperCase()} ${path}`
          );
          err.status = res.status;
          err.response = res;
          err.durationMs = ms;
          throw err;
        }

        return { data: res.data, status: res.status, durationMs: ms };
      } catch (error) {
        const ms = Date.now() - start;

        if (requestSignal?.aborted) {
          const err = new Error("Aborted");
          err.code = "ABORT_ERR";
          throw err;
        }

        const transient = isTransientError(error);

        if (transient && attempt <= this.maxRetries + 1) {
          const backoff = Math.min(1000 * attempt, 3000);
          this.logger?.warn?.(
            `Transient error (attempt ${attempt}) ${method.toUpperCase()} ${path}: `,
            error.message,
            ` backoff=${backoff}ms`
          );
          await sleep(backoff, requestSignal).catch(() => {});
          continue;
        }

        this.logger?.error?.(
          `API error ${method.toUpperCase()} ${path} after ${attempt} attempts (${ms}ms): `,
          error.message
        );
        throw error;
      }
    }
  }

  get(path, options) {
    return this.request("get", path, options);
  }

  post(path, options) {
    return this.request("post", path, options);
  }

  patch(path, options) {
    return this.request("patch", path, options);
  }
}

module.exports = ApiClient;
