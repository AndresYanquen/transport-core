import { io } from "socket.io-client";

import { buildApiUrl } from "./api.js";

export function createRealtimeSocket(token) {
  const baseUrl = buildApiUrl("");
  const socketUrl = baseUrl || undefined;

  return io(socketUrl, {
    path: import.meta.env.VITE_SOCKET_PATH || "/socket.io",
    transports: ["websocket", "polling"],
    auth: {
      token,
    },
  });
}
