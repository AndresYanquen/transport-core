let io = null;

class SocketClient {
  constructor({ socketUrl, path = "/socket.io", logger }) {
    this.socketUrl = socketUrl;
    this.path = path;
    this.logger = logger;
    this.socket = null;
    this.readyPromise = null;
  }

  static load() {
    if (!io) {
      // Lazy require so simulator can run without socket.io-client when sockets disabled.
      // eslint-disable-next-line global-require
      io = require("socket.io-client");
    }
    return io;
  }

  connect({ token }) {
    const { io: ioFn } = SocketClient.load();
    this.socket = ioFn(this.socketUrl, {
      path: this.path,
      auth: { token },
      // Prefer websocket, but allow upgrade fallback (some environments block ws).
      transports: ["websocket", "polling"],
    });

    this.readyPromise = new Promise((resolve) => {
      if (this.socket.connected) {
        resolve();
        return;
      }

      const onReady = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        this.socket.off("connect", onReady);
        this.socket.off("realtime:ready", onReady);
      };

      this.socket.on("connect", onReady);
      this.socket.on("realtime:ready", onReady);
    });

    this.socket.on("connect_error", (err) => {
      this.logger?.warn?.("socket connect_error: ", err.message);
    });

    return this.socket;
  }

  emit(event, payload) {
    if (!this.socket) return;
    this.socket.emit(event, payload);
  }

  on(event, handler) {
    if (!this.socket) return;
    this.socket.on(event, handler);
  }

  off(event, handler) {
    if (!this.socket) return;
    this.socket.off(event, handler);
  }

  async subscribeRide(rideId, { timeoutMs = 4000 } = {}) {
    if (!this.socket) {
      throw new Error("Socket not connected");
    }

    await this.waitUntilReady({ timeoutMs });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("ride:subscribe timeout"));
      }, timeoutMs);

      const onOk = (payload = {}) => {
        if (payload.rideId !== rideId) return;
        cleanup();
        resolve(payload);
      };

      const onDenied = (payload = {}) => {
        if (payload.rideId !== rideId) return;
        cleanup();
        const err = new Error(`ride:subscribe denied (${payload.reason || "unknown"})`);
        err.reason = payload.reason;
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off("ride:subscribed", onOk);
        this.socket.off("ride:subscribe-denied", onDenied);
      };

      this.socket.on("ride:subscribed", onOk);
      this.socket.on("ride:subscribe-denied", onDenied);
      this.socket.emit("ride:subscribe", { rideId });
    });
  }

  async waitUntilReady({ timeoutMs = 4000 } = {}) {
    if (!this.socket) {
      throw new Error("Socket not connected");
    }

    if (this.socket.connected) {
      return;
    }

    await Promise.race([
      this.readyPromise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("socket ready timeout")), timeoutMs);
      }),
    ]);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.readyPromise = null;
    }
  }
}

module.exports = SocketClient;
