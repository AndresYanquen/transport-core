<script setup>
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import { Car, ClipboardList, MapPinned, RadioTower, RefreshCw, Users } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const auth = useAuthStore();

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

const pendingStatuses = ["requested", "pending_driver"];
const assignedStatuses = ["driver_assigned", "driver_en_route", "driver_arrived"];

const state = reactive({
  loading: true,
  error: "",
  rides: [],
  drivers: [],
  lastUpdatedAt: null,
});

let socket = null;
let refreshTimer = null;

async function fetchOverview({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const [ridesData, driversData] = await Promise.all([
      apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" }),
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
    ]);
    state.rides = ridesData?.rides || [];
    state.drivers = driversData?.drivers || [];
    state.lastUpdatedAt = driversData?.server?.now || new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudo cargar el resumen de operación.";
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchOverview({ quiet: true }));
  socket.on("admin:driver-location-updated", () => fetchOverview({ quiet: true }));
  socket.on("admin:driver-status-updated", () => fetchOverview({ quiet: true }));
}

function parseMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isToday(value) {
  const ms = parseMs(value);
  if (!ms) return false;
  const date = new Date(ms);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatTime(value) {
  const ms = parseMs(value);
  if (!ms) return "--:--";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 8 ? value.slice(0, 8) : value;
}

function activityText(ride) {
  const id = shortId(ride.id);
  const passenger = ride.passenger || ride.client;
  const name = passenger?.fullName || [passenger?.firstName, passenger?.lastName].filter(Boolean).join(" ").trim() || "Cliente";

  const labels = {
    requested: `${name} solicitó servicio #${id}`,
    pending_driver: `Servicio #${id} esperando conductor`,
    driver_assigned: `Conductor asignado al servicio #${id}`,
    driver_en_route: `Conductor en camino al servicio #${id}`,
    driver_arrived: `Conductor llegó al servicio #${id}`,
    in_progress: `Servicio #${id} en curso`,
    completed: `Servicio #${id} finalizado`,
    canceled_by_client: `${name} canceló servicio #${id}`,
    canceled_by_driver: `Conductor canceló servicio #${id}`,
    canceled_by_system: `Sistema canceló servicio #${id}`,
    no_show: `Servicio #${id} marcado no show`,
  };

  return labels[ride.status] || `Servicio #${id} actualizado`;
}

const pendingRides = computed(() => state.rides.filter((ride) => pendingStatuses.includes(ride.status)));
const assignedRides = computed(() => state.rides.filter((ride) => assignedStatuses.includes(ride.status)));
const inProgressRides = computed(() => state.rides.filter((ride) => ride.status === "in_progress"));
const activeRides = computed(() => state.rides.filter((ride) => !terminalStatuses.includes(ride.status)));
const completedTodayRides = computed(() =>
  state.rides.filter((ride) => ride.status === "completed" && isToday(ride.completedAt || ride.updatedAt || ride.requestedAt)),
);

const onlineDrivers = computed(() =>
  state.drivers.filter((driver) => ["online", "busy"].includes(String(driver.status || "").toLowerCase())),
);
const busyDrivers = computed(() =>
  state.drivers.filter((driver) => String(driver.status || "").toLowerCase() === "busy" || driver.currentRideId),
);
const availableDrivers = computed(() =>
  state.drivers.filter((driver) => String(driver.status || "").toLowerCase() === "online" && !driver.currentRideId),
);

const sections = computed(() => [
  {
    title: "Solicitudes",
    icon: ClipboardList,
    rows: [
      { label: "Pendientes", value: pendingRides.value.length },
      { label: "Asignadas", value: assignedRides.value.length },
      { label: "En curso", value: inProgressRides.value.length },
      { label: "Finalizadas hoy", value: completedTodayRides.value.length },
    ],
  },
  {
    title: "Conductores",
    icon: Car,
    rows: [
      { label: "Online", value: onlineDrivers.value.length },
      { label: "Ocupados", value: busyDrivers.value.length },
      { label: "Disponibles", value: availableDrivers.value.length },
    ],
  },
  {
    title: "Clientes",
    icon: Users,
    rows: [
      { label: "Esperando conductor", value: pendingRides.value.length },
      { label: "Viajes activos", value: activeRides.value.length },
    ],
  },
]);

const activity = computed(() =>
  [...state.rides]
    .sort((a, b) => (parseMs(b.updatedAt || b.requestedAt) || 0) - (parseMs(a.updatedAt || a.requestedAt) || 0))
    .slice(0, 3)
    .map((ride) => ({
      time: formatTime(ride.updatedAt || ride.requestedAt),
      text: activityText(ride),
    })),
);

const mapPoints = computed(() => {
  const driverPoints = onlineDrivers.value
    .map((driver) => ({
      key: `driver-${driver.userId || driver.id}`,
      label: "T",
      class: "bg-emerald-600",
      location: driver.currentLocation,
    }))
    .filter((point) => hasLocation(point.location))
    .slice(0, 3);
  const requestPoints = activeRides.value
    .map((ride) => ({
      key: `ride-${ride.id}`,
      label: "S",
      class: "bg-sky-600",
      location: ride.pickupLocation,
    }))
    .filter((point) => hasLocation(point.location))
    .slice(0, 2);
  return projectMapPoints([...driverPoints, ...requestPoints]);
});

function hasLocation(location) {
  return Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lng));
}

function projectMapPoints(points) {
  if (!points.length) return [];
  const lats = points.map((point) => Number(point.location.lat));
  const lngs = points.map((point) => Number(point.location.lng));
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 0.01;
  const lngSpan = maxLng - minLng || 0.01;

  return points.map((point) => ({
    key: point.key,
    label: point.label,
    class: point.class,
    left: `${14 + ((Number(point.location.lng) - minLng) / lngSpan) * 72}%`,
    top: `${14 + ((maxLat - Number(point.location.lat)) / latSpan) * 72}%`,
  }));
}

const actions = [
  { label: "Nueva asignación", to: "/admin/operacion/asignaciones" },
  { label: "Ver solicitudes", to: "/admin/operacion/solicitudes" },
  { label: "Abrir mapa", to: "/admin/dashboard/mapa" },
  { label: "Conductores online", to: "/admin/conductores/list" },
];

onMounted(() => {
  fetchOverview();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchOverview({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (socket) socket.disconnect();
});
</script>

<template>
  <section class="min-h-full bg-slate-100 p-4 text-slate-950 md:p-6">
    <div class="mx-auto grid max-w-6xl gap-5">
      <header class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 pb-4">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Operación</p>
          <h1 class="mt-1 text-2xl font-semibold text-slate-950">Dashboard resumen</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            <RadioTower class="h-4 w-4 text-emerald-600" />
            Tiempo real activo
          </div>
          <button
            class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            :disabled="state.loading"
            type="button"
            @click="fetchOverview()"
          >
            <RefreshCw class="h-4 w-4" />
            Actualizar
          </button>
        </div>
      </header>

      <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
        {{ state.error }}
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <article
          v-for="section in sections"
          :key="section.title"
          class="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div class="mb-3 flex items-center gap-2">
            <span class="grid h-8 w-8 place-items-center rounded-md bg-slate-950 text-white">
              <component :is="section.icon" class="h-4 w-4" />
            </span>
            <h2 class="text-base font-semibold text-slate-950">{{ section.title }}</h2>
          </div>

          <dl class="grid gap-2">
            <div
              v-for="row in section.rows"
              :key="row.label"
              class="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-0"
            >
              <dt class="text-sm text-slate-600">{{ row.label }}</dt>
              <dd class="font-mono text-xl font-semibold tabular-nums text-slate-950">{{ state.loading ? "-" : row.value }}</dd>
            </div>
          </dl>
        </article>
      </div>

      <section class="border-y border-slate-300 py-5">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Mapa en tiempo real</h2>
            <p class="text-sm text-slate-500">Vehículos y solicitudes geolocalizadas</p>
          </div>
          <RouterLink class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" to="/admin/dashboard/mapa">
            <MapPinned class="h-4 w-4" />
            Abrir
          </RouterLink>
        </div>

        <div class="relative h-72 overflow-hidden rounded-md border border-slate-300 bg-slate-200">
          <div class="absolute inset-0 bg-[linear-gradient(to_right,rgba(71,85,105,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(71,85,105,0.18)_1px,transparent_1px)] bg-[size:36px_36px]"></div>

          <div
            v-for="point in mapPoints"
            :key="point.key"
            :class="['absolute grid h-7 w-7 place-items-center rounded-full border-2 border-white text-xs font-bold text-white shadow', point.class]"
            :style="{ left: point.left, top: point.top }"
          >
            {{ point.label }}
          </div>
          <div v-if="!state.loading && !mapPoints.length" class="absolute inset-0 grid place-items-center text-sm text-slate-500">
            Sin ubicaciones activas
          </div>
        </div>
      </section>

      <div class="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 class="text-base font-semibold text-slate-950">Actividad reciente</h2>
          <div class="mt-3 grid gap-3">
            <div v-for="item in activity" :key="`${item.time}-${item.text}`" class="flex gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
              <time class="w-12 shrink-0 font-mono text-sm font-semibold text-slate-500">{{ item.time }}</time>
              <p class="min-w-0 text-sm text-slate-800">{{ item.text }}</p>
            </div>
            <p v-if="!state.loading && !activity.length" class="text-sm text-slate-500">Sin actividad reciente.</p>
          </div>
        </section>

        <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 class="text-base font-semibold text-slate-950">Acciones rápidas</h2>
          <div class="mt-3 grid gap-2">
            <RouterLink
              v-for="action in actions"
              :key="action.label"
              class="inline-flex h-10 items-center justify-center rounded-md border border-slate-950 bg-slate-950 px-3 text-sm font-semibold !text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950/20"
              :to="action.to"
            >
              {{ action.label }}
            </RouterLink>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
