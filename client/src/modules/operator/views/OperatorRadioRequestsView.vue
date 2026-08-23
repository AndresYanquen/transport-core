<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, shallowRef } from "vue";
import {
  CheckCircle2,
  Clock3,
  Headphones,
  Mic,
  MicOff,
  PhoneCall,
  Radio,
  RefreshCw,
  Search,
  Users,
  Wifi,
  X,
  XCircle,
} from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const auth = useAuthStore();
const roomRef = shallowRef(null);

const statusOptions = [
  { value: "pending", label: "Pendientes" },
  { value: "accepted", label: "Aceptadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "canceled", label: "Canceladas" },
  { value: "expired", label: "Expiradas" },
];

const priorityMeta = {
  emergency: { label: "Emergencia", class: "border-red-200 bg-red-50 text-red-700" },
  active_ride: { label: "Viaje activo", class: "border-amber-200 bg-amber-50 text-amber-800" },
  normal: { label: "Normal", class: "border-slate-200 bg-slate-50 text-slate-700" },
};

const state = reactive({
  loading: true,
  actionId: "",
  error: "",
  success: "",
  requests: [],
  lastUpdatedAt: null,
  socketConnected: false,
});

const filters = reactive({
  status: "pending",
  search: "",
});

const radio = reactive({
  open: false,
  request: null,
  session: null,
  tokenLoading: false,
  connecting: false,
  disconnecting: false,
  ending: false,
  error: "",
  micError: "",
  livekit: null,
  connectionState: "disconnected",
  roomName: "",
  participantCount: 0,
  micLoading: false,
  micPublished: false,
  micMuted: true,
  talkLoading: false,
  talking: false,
  talkDenied: "",
  remoteTalking: null,
});

let socket = null;
let clearSuccessTimer = null;
let heartbeatTimer = null;

const isOperator = computed(() => String(auth.state.user?.role || "").toLowerCase() === "operator");
const isConnected = computed(() => radio.connectionState === "connected");
const canTalk = computed(() => isConnected.value && radio.micPublished && !radio.micMuted && !radio.talkLoading);
const micStatus = computed(() => {
  if (radio.micLoading) return "Procesando";
  if (!radio.micPublished) return "Sin publicar";
  return radio.micMuted ? "Muteado" : "Activo";
});

const filteredRequests = computed(() => {
  const q = filters.search.trim().toLowerCase();
  if (!q) return state.requests;

  return state.requests.filter((request) => [
    request.id,
    request.driverId,
    request.rideId,
    request.reason,
    request.priority,
    request.driver?.firstName,
    request.driver?.lastName,
    request.driver?.email,
  ].filter(Boolean).join(" ").toLowerCase().includes(q));
});

const summary = computed(() => {
  const emergency = state.requests.filter((request) => request.priority === "emergency").length;
  const activeRide = state.requests.filter((request) => request.priority === "active_ride").length;
  return [
    { label: statusLabel(filters.status), value: state.requests.length, icon: Headphones },
    { label: "Emergencia", value: emergency, icon: XCircle },
    { label: "Viaje activo", value: activeRide, icon: PhoneCall },
    { label: "En vivo", value: state.socketConnected ? "Si" : "No", icon: CheckCircle2 },
  ];
});

function statusLabel(status) {
  return statusOptions.find((item) => item.value === status)?.label || status;
}

function priorityLabel(priority) {
  return priorityMeta[priority]?.label || priority || "-";
}

function priorityClass(priority) {
  return priorityMeta[priority]?.class || priorityMeta.normal.class;
}

function driverName(request = radio.request) {
  const driver = request?.driver || {};
  const name = [driver.firstName, driver.lastName].filter(Boolean).join(" ").trim();
  return name || driver.email || shortId(request?.driverId);
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatAge(value) {
  if (!value) return "-";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

function showSuccess(message) {
  state.success = message;
  if (clearSuccessTimer) window.clearTimeout(clearSuccessTimer);
  clearSuccessTimer = window.setTimeout(() => {
    state.success = "";
    clearSuccessTimer = null;
  }, 3500);
}

function resetRadioState() {
  radio.request = null;
  radio.session = null;
  radio.error = "";
  radio.micError = "";
  radio.livekit = null;
  radio.connectionState = "disconnected";
  radio.roomName = "";
  radio.participantCount = 0;
  radio.micLoading = false;
  radio.micPublished = false;
  radio.micMuted = true;
  radio.talkLoading = false;
  radio.talking = false;
  radio.talkDenied = "";
  radio.remoteTalking = null;
}

function updateParticipantCount(room = roomRef.value) {
  radio.participantCount = room ? room.remoteParticipants.size + (room.localParticipant ? 1 : 0) : 0;
}

function updateMicrophoneState(room = roomRef.value) {
  const publication = room?.localParticipant?.getTrackPublication?.("microphone");
  radio.micPublished = Boolean(publication);
  radio.micMuted = publication ? Boolean(publication.isMuted) : true;
}

function bindRoomEvents(room, RoomEvent) {
  room
    .on(RoomEvent.Connected, () => {
      radio.connectionState = "connected";
      radio.roomName = room.name || radio.livekit?.room || "";
      updateParticipantCount(room);
    })
    .on(RoomEvent.Disconnected, () => {
      radio.connectionState = "disconnected";
      radio.participantCount = 0;
      stopTalkHeartbeat();
    })
    .on(RoomEvent.Reconnecting, () => {
      radio.connectionState = "reconnecting";
    })
    .on(RoomEvent.Reconnected, () => {
      radio.connectionState = "connected";
      updateParticipantCount(room);
    })
    .on(RoomEvent.LocalTrackPublished, () => updateMicrophoneState(room))
    .on(RoomEvent.LocalTrackUnpublished, () => updateMicrophoneState(room))
    .on(RoomEvent.TrackMuted, () => updateMicrophoneState(room))
    .on(RoomEvent.TrackUnmuted, () => updateMicrophoneState(room))
    .on(RoomEvent.ParticipantConnected, () => updateParticipantCount(room))
    .on(RoomEvent.ParticipantDisconnected, () => updateParticipantCount(room));
}

async function fetchRequests({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const params = new URLSearchParams({
      status: filters.status,
      limit: "200",
    });
    const data = await apiRequest(`/api/radio/requests?${params}`, { method: "GET" });
    state.requests = data?.requests || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (error) {
    state.error = error?.message || "No se pudieron cargar las solicitudes de radio.";
  } finally {
    state.loading = false;
  }
}

async function fetchSessionToken() {
  if (!radio.session?.id) return;
  radio.tokenLoading = true;
  radio.error = "";

  try {
    const result = await apiRequest(`/api/radio/sessions/${radio.session.id}/livekit-token`, { method: "GET" });
    radio.session = result?.session || radio.session;
    radio.livekit = result?.livekit || null;
    radio.roomName = radio.livekit?.room || "";
  } catch (error) {
    radio.error = error?.message || "No se pudo obtener el token de radio.";
  } finally {
    radio.tokenLoading = false;
  }
}

async function connectLiveKit() {
  radio.error = "";

  if (!radio.livekit?.url || !radio.livekit?.token) {
    await fetchSessionToken();
  }

  if (!radio.livekit?.url || !radio.livekit?.token) return;

  await disconnectLiveKit({ silent: true });
  radio.connecting = true;
  radio.connectionState = "connecting";

  try {
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    bindRoomEvents(room, RoomEvent);
    roomRef.value = room;
    await room.connect(radio.livekit.url, radio.livekit.token);
    updateParticipantCount(room);
    updateMicrophoneState(room);
  } catch (error) {
    radio.connectionState = "disconnected";
    roomRef.value = null;
    radio.error = error?.message || "No se pudo conectar la sala de radio.";
  } finally {
    radio.connecting = false;
  }
}

async function enableMicrophone() {
  radio.error = "";
  radio.micError = "";

  if (!isConnected.value) {
    await connectLiveKit();
  }

  const room = roomRef.value;
  if (!room || !isConnected.value) return;

  radio.micLoading = true;
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    updateMicrophoneState(room);
  } catch (error) {
    radio.micError = error?.message || "No se pudo activar el micrófono.";
  } finally {
    radio.micLoading = false;
  }
}

async function disableMicrophone() {
  const room = roomRef.value;
  if (!room || !radio.micPublished) return;

  radio.micLoading = true;
  radio.micError = "";
  try {
    await stopTalking();
    await room.localParticipant.setMicrophoneEnabled(false);
    updateMicrophoneState(room);
  } catch (error) {
    radio.micError = error?.message || "No se pudo apagar el micrófono.";
  } finally {
    radio.micLoading = false;
  }
}

function startTalkHeartbeat() {
  stopTalkHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    if (socket && radio.session?.id && radio.talking) {
      socket.emit("radio:talk:heartbeat", { sessionId: radio.session.id });
    }
  }, 4000);
}

function stopTalkHeartbeat() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function startTalking() {
  if (!socket || !radio.session?.id || !canTalk.value || radio.talking) return;
  radio.talkLoading = true;
  radio.talkDenied = "";
  socket.emit("radio:talk:start", { sessionId: radio.session.id });
}

async function stopTalking() {
  if (!socket || !radio.session?.id || !radio.talking) return;
  socket.emit("radio:talk:stop", { sessionId: radio.session.id });
  radio.talking = false;
  stopTalkHeartbeat();
}

async function disconnectLiveKit({ silent = false } = {}) {
  const room = roomRef.value;
  if (!room) return;

  radio.disconnecting = true;
  try {
    await stopTalking();
    await room.disconnect();
  } catch (error) {
    if (!silent) radio.error = error?.message || "No se pudo desconectar de LiveKit.";
  } finally {
    room.removeAllListeners();
    roomRef.value = null;
    radio.disconnecting = false;
    radio.connectionState = "disconnected";
    radio.participantCount = 0;
    radio.micPublished = false;
    radio.micMuted = true;
    stopTalkHeartbeat();
  }
}

async function acceptRequest(request) {
  if (!request?.id || !isOperator.value) return;
  state.actionId = request.id;
  state.error = "";

  try {
    const result = await apiRequest(`/api/radio/requests/${request.id}/accept`, { method: "POST" });
    openRadioModal({ request, session: result?.session || null });
    showSuccess(`Sesión de radio creada para ${driverName(request)}.`);
    await fetchRequests({ quiet: true });
  } catch (error) {
    state.error = error?.message || "No se pudo aceptar la solicitud.";
  } finally {
    state.actionId = "";
  }
}

async function rejectRequest(request) {
  if (!request?.id || !isOperator.value) return;
  state.actionId = request.id;
  state.error = "";

  try {
    await apiRequest(`/api/radio/requests/${request.id}/reject`, {
      method: "POST",
      body: { reason: "operator_busy" },
    });
    showSuccess(`Solicitud de ${driverName(request)} rechazada.`);
    await fetchRequests({ quiet: true });
  } catch (error) {
    state.error = error?.message || "No se pudo rechazar la solicitud.";
  } finally {
    state.actionId = "";
  }
}

async function openRadioModal({ request, session }) {
  resetRadioState();
  radio.open = true;
  radio.request = request;
  radio.session = session;
  await fetchSessionToken();
  await connectLiveKit();
}

async function closeRadioModal() {
  await disconnectLiveKit({ silent: true });
  radio.open = false;
  resetRadioState();
}

async function endRadioSession() {
  if (!socket || !radio.session?.id) {
    await closeRadioModal();
    return;
  }

  radio.ending = true;
  socket.emit("radio:end", { sessionId: radio.session.id, reason: "operator_closed" });
  window.setTimeout(async () => {
    radio.ending = false;
    await closeRadioModal();
    await fetchRequests({ quiet: true });
  }, 400);
}

function handleTalkGranted(payload = {}) {
  if (payload.sessionId !== radio.session?.id) return;
  radio.talking = true;
  radio.talkLoading = false;
  radio.talkDenied = "";
  startTalkHeartbeat();
}

function handleTalkDenied(payload = {}) {
  if (payload.sessionId !== radio.session?.id) return;
  radio.talking = false;
  radio.talkLoading = false;
  radio.talkDenied = payload.reason === "busy"
    ? "El conductor u otra parte tiene el canal ocupado."
    : "No se pudo tomar el turno de voz.";
  stopTalkHeartbeat();
}

function handleTalkStopped(payload = {}) {
  if (payload.sessionId !== radio.session?.id) return;
  radio.talking = false;
  radio.talkLoading = false;
  stopTalkHeartbeat();
}

function handleTalkChanged(payload = {}) {
  if (payload.sessionId !== radio.session?.id) return;
  const talk = payload.talk || null;
  radio.remoteTalking = talk && talk.userId !== auth.state.user?.id ? talk : null;
  if (!talk || talk.userId !== auth.state.user?.id) {
    radio.talking = false;
    radio.talkLoading = false;
    stopTalkHeartbeat();
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("connect", () => { state.socketConnected = true; });
  socket.on("disconnect", () => { state.socketConnected = false; });
  socket.on("connect_error", () => { state.socketConnected = false; });
  socket.on("operations:radio-request-created", () => fetchRequests({ quiet: true }));
  socket.on("operations:radio-request-updated", () => fetchRequests({ quiet: true }));
  socket.on("operations:radio-session-updated", () => fetchRequests({ quiet: true }));
  socket.on("radio:talk:granted", handleTalkGranted);
  socket.on("radio:talk:denied", handleTalkDenied);
  socket.on("radio:talk:stopped", handleTalkStopped);
  socket.on("radio:talk:changed", handleTalkChanged);
  socket.on("radio:ended", () => closeRadioModal());
}

onMounted(() => {
  fetchRequests();
  connectRealtime();
});

onBeforeUnmount(() => {
  disconnectLiveKit({ silent: true });
  socket?.disconnect();
  socket = null;
  if (clearSuccessTimer) window.clearTimeout(clearSuccessTimer);
  stopTalkHeartbeat();
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Radio</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Solicitudes de conductores</h1>
        <p class="mt-1 text-sm text-slate-500">Cola para contactar conductores que pidieron hablar con operación.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchRequests()"
      >
        <RefreshCw :class="['h-4 w-4', state.loading ? 'animate-spin' : '']" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>
    <div v-if="state.success" class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {{ state.success }}
    </div>

    <div class="grid gap-3 md:grid-cols-4">
      <article v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
          </div>
          <span class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="item.icon" class="h-4 w-4" />
          </span>
        </div>
      </article>
    </div>

    <section class="rounded-md border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Cola de radio</h2>
          <p class="mt-1 text-sm text-slate-500">{{ filteredRequests.length }} solicitudes visibles · Actualizado {{ formatDate(state.lastUpdatedAt) }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-72 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
              placeholder="Buscar conductor, viaje o motivo"
              type="search"
            />
          </label>
          <select
            v-model="filters.status"
            class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
            @change="fetchRequests()"
          >
            <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[980px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Conductor</th>
              <th class="px-4 py-3">Prioridad</th>
              <th class="px-4 py-3">Motivo</th>
              <th class="px-4 py-3">Viaje</th>
              <th class="px-4 py-3">Edad</th>
              <th class="px-4 py-3">Expira</th>
              <th class="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in filteredRequests" :key="request.id" class="border-b border-slate-100 text-slate-700 hover:bg-slate-50">
              <td class="px-4 py-3">
                <div class="font-medium text-slate-950">{{ driverName(request) }}</div>
                <div class="text-xs text-slate-500">{{ request.driver?.email || shortId(request.driverId) }}</div>
              </td>
              <td class="px-4 py-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', priorityClass(request.priority)]">
                  {{ priorityLabel(request.priority) }}
                </span>
              </td>
              <td class="px-4 py-3">{{ request.reason || "-" }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ shortId(request.rideId) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-1">
                  <Clock3 class="h-3.5 w-3.5 text-slate-400" />
                  {{ formatAge(request.createdAt) }}
                </div>
                <div class="text-xs text-slate-500">{{ formatDate(request.createdAt) }}</div>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ formatDate(request.expiresAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-2">
                  <button
                    class="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    :disabled="!isOperator || request.status !== 'pending' || state.actionId === request.id"
                    type="button"
                    @click="acceptRequest(request)"
                  >
                    <CheckCircle2 class="h-3.5 w-3.5" />
                    Atender
                  </button>
                  <button
                    class="inline-flex h-8 items-center gap-1 rounded-md border border-rose-200 bg-white px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    :disabled="!isOperator || request.status !== 'pending' || state.actionId === request.id"
                    type="button"
                    @click="rejectRequest(request)"
                  >
                    <XCircle class="h-3.5 w-3.5" />
                    Rechazar
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!state.loading && !filteredRequests.length" class="py-10 text-center text-sm text-slate-500">
        No hay solicitudes de radio para los filtros seleccionados.
      </div>
    </section>

    <div v-if="radio.open" class="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <section class="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <header class="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
          <div>
            <p class="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Radio con conductor</p>
            <h2 class="mt-1 text-xl font-semibold text-slate-950">{{ driverName() }}</h2>
            <p class="mt-1 text-sm text-slate-500">Sala {{ radio.roomName || radio.livekit?.room || shortId(radio.session?.id) }}</p>
          </div>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" type="button" @click="closeRadioModal">
            <X class="h-4 w-4" />
          </button>
        </header>

        <div class="grid max-h-[calc(92vh-73px)] gap-4 overflow-y-auto p-4">
          <div v-if="radio.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {{ radio.error }}
          </div>
          <div v-if="radio.micError" class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {{ radio.micError }}
          </div>
          <div v-if="radio.talkDenied" class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {{ radio.talkDenied }}
          </div>

          <div class="grid gap-3 md:grid-cols-4">
            <article class="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div class="text-xs uppercase tracking-wide text-slate-500">Conexion</div>
              <div class="mt-1 flex items-center gap-2 text-base font-semibold capitalize text-slate-950">
                <Wifi class="h-4 w-4" />
                {{ radio.connectionState }}
              </div>
            </article>
            <article class="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div class="text-xs uppercase tracking-wide text-slate-500">Participantes</div>
              <div class="mt-1 flex items-center gap-2 text-base font-semibold text-slate-950">
                <Users class="h-4 w-4" />
                {{ radio.participantCount }}
              </div>
            </article>
            <article class="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div class="text-xs uppercase tracking-wide text-slate-500">Microfono</div>
              <div class="mt-1 flex items-center gap-2 text-base font-semibold text-slate-950">
                <component :is="radio.micPublished && !radio.micMuted ? Mic : MicOff" class="h-4 w-4" />
                {{ micStatus }}
              </div>
            </article>
            <article class="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div class="text-xs uppercase tracking-wide text-slate-500">Canal</div>
              <div class="mt-1 flex items-center gap-2 text-base font-semibold text-slate-950">
                <Radio class="h-4 w-4" />
                {{ radio.talking ? "Hablando" : radio.remoteTalking ? "Ocupado" : "Libre" }}
              </div>
            </article>
          </div>

          <section class="rounded-md border border-slate-200 p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 class="text-base font-semibold text-slate-950">Controles de llamada</h3>
                <p class="mt-1 text-sm text-slate-500">Conecta la sala, activa el microfono y toma el turno para hablar.</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  :disabled="radio.tokenLoading || radio.connecting || isConnected"
                  type="button"
                  @click="connectLiveKit"
                >
                  <Wifi :class="['h-4 w-4', radio.connecting ? 'animate-pulse' : '']" />
                  Conectar
                </button>
                <button
                  class="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  :disabled="radio.micLoading || (radio.micPublished && !radio.micMuted)"
                  type="button"
                  @click="enableMicrophone"
                >
                  <Mic :class="['h-4 w-4', radio.micLoading ? 'animate-pulse' : '']" />
                  Activar microfono
                </button>
                <button
                  class="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  :disabled="radio.micLoading || !radio.micPublished"
                  type="button"
                  @click="disableMicrophone"
                >
                  <MicOff class="h-4 w-4" />
                  Apagar microfono
                </button>
              </div>
            </div>

            <div class="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div class="text-sm text-slate-600">
                <span v-if="radio.remoteTalking">El canal esta ocupado por {{ radio.remoteTalking.role || "otro usuario" }}.</span>
                <span v-else-if="radio.talking">Tu audio esta autorizado en el canal.</span>
                <span v-else>Manten presionado para hablar con el conductor.</span>
              </div>
              <button
                :class="[
                  'inline-flex h-12 select-none items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white disabled:opacity-50',
                  radio.talking ? 'bg-emerald-600' : 'bg-slate-950 hover:bg-slate-800'
                ]"
                :disabled="!canTalk"
                type="button"
                @mousedown="startTalking"
                @mouseup="stopTalking"
                @mouseleave="stopTalking"
                @touchstart.prevent="startTalking"
                @touchend.prevent="stopTalking"
              >
                <Mic class="h-4 w-4" />
                {{ radio.talking ? "Hablando" : radio.talkLoading ? "Tomando turno" : "Mantener para hablar" }}
              </button>
            </div>
          </section>

          <footer class="flex flex-wrap justify-end gap-2">
            <button
              class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              type="button"
              @click="closeRadioModal"
            >
              Cerrar modal
            </button>
            <button
              class="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              :disabled="radio.ending"
              type="button"
              @click="endRadioSession"
            >
              <XCircle class="h-4 w-4" />
              Finalizar radio
            </button>
          </footer>
        </div>
      </section>
    </div>
  </section>
</template>
