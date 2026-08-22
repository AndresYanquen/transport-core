import { computed, reactive } from "vue";
import { apiRequest } from "../services/api.js";
import { createRealtimeSocket } from "../services/realtime.js";

const state = reactive({
  unreadPanicCount: 0,
  latestPanic: null,
  loading: false,
  error: "",
});

let socket = null;
let connectedToken = "";

function upsertLatest(notification) {
  if (!notification) return;
  state.latestPanic = notification;
}

async function refreshUnreadPanicCount() {
  state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/driver-notifications?status=unread&type=panic&limit=200", {
      method: "GET",
    });
    const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
    state.unreadPanicCount = notifications.length;
    state.latestPanic = notifications[0] || state.latestPanic;
    return notifications;
  } catch (error) {
    state.error = error?.message || "No se pudieron cargar las alertas.";
    throw error;
  } finally {
    state.loading = false;
  }
}

function connectDriverNotifications(token) {
  if (!token || socket) return;
  connectedToken = token;
  socket = createRealtimeSocket(token);

  socket.on("operations:driver-panic-created", ({ notification } = {}) => {
    upsertLatest(notification);
    refreshUnreadPanicCount().catch(() => {});
  });
  socket.on("operations:driver-notification-acknowledged", () => {
    refreshUnreadPanicCount().catch(() => {});
  });
  socket.on("operations:driver-notification-resolved", () => {
    refreshUnreadPanicCount().catch(() => {});
  });
}

function disconnectDriverNotifications() {
  socket?.disconnect();
  socket = null;
  connectedToken = "";
}

function resetDriverNotifications() {
  disconnectDriverNotifications();
  state.unreadPanicCount = 0;
  state.latestPanic = null;
  state.loading = false;
  state.error = "";
}

export function useDriverNotificationsStore() {
  const hasUnreadPanic = computed(() => state.unreadPanicCount > 0);

  return {
    state,
    hasUnreadPanic,
    connectedToken: () => connectedToken,
    refreshUnreadPanicCount,
    connectDriverNotifications,
    disconnectDriverNotifications,
    resetDriverNotifications,
  };
}
