<script setup>
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import { useRouter } from "vue-router";
import { CheckCircle2, Clock3, Headphones, PhoneCall, RefreshCw, Search, XCircle } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const auth = useAuthStore();
const router = useRouter();

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
  activeSession: null,
});

const filters = reactive({
  status: "pending",
  search: "",
});

let socket = null;
let clearSuccessTimer = null;

const isOperator = computed(() => String(auth.state.user?.role || "").toLowerCase() === "operator");

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
    { label: "En vivo", value: state.socketConnected ? "Sí" : "No", icon: CheckCircle2 },
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

function driverName(request) {
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

async function acceptRequest(request) {
  if (!request?.id || !isOperator.value) return;
  state.actionId = request.id;
  state.error = "";

  try {
    const result = await apiRequest(`/api/radio/requests/${request.id}/accept`, { method: "POST" });
    state.activeSession = result?.session || null;
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

function openActivity() {
  router.push(isOperator.value ? "/operator/operacion/radio/activity" : "/admin/operadoras/activity");
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
}

onMounted(() => {
  fetchRequests();
  connectRealtime();
});

onBeforeUnmount(() => {
  socket?.disconnect();
  socket = null;
  if (clearSuccessTimer) window.clearTimeout(clearSuccessTimer);
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
      <div class="flex flex-wrap gap-2">
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          :disabled="state.loading"
          type="button"
          @click="fetchRequests()"
        >
          <RefreshCw :class="['h-4 w-4', state.loading ? 'animate-spin' : '']" />
          Actualizar
        </button>
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800"
          type="button"
          @click="openActivity"
        >
          <Headphones class="h-4 w-4" />
          Prueba LiveKit
        </button>
      </div>
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

    <section v-if="state.activeSession" class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div class="font-semibold">Sesión creada</div>
      <div class="mt-1">ID sesión: <span class="font-mono">{{ state.activeSession.id }}</span></div>
    </section>

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
  </section>
</template>
