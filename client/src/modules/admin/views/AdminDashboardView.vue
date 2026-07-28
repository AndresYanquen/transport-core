<script setup>
import {
  AlertTriangle,
  ArrowRight,
  Car,
  Clock3,
  DollarSign,
  MapPinned,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-vue-next";
import { computed, onMounted, reactive } from "vue";
import { RouterLink } from "vue-router";
import { apiRequest } from "../../../services/api.js";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const operationalSettings = useOperationalSettings();

const state = reactive({
  loading: true,
  error: "",
  payload: null,
  lastUpdatedAt: null,
});

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

const serviceLabels = {
  standard: "Taxi",
  premium: "Taxi",
  xl: "Taxi",
  pool: "Taxi",
  package_delivery: "Baúl",
  food_delivery: "Domicilio",
  car_unstuck: "Despinchada",
  jump_start: "Despinchada",
  tire_change: "Despinchada",
};

async function fetchDashboard() {
  state.loading = true;
  state.error = "";

  try {
    const [ridesData, driversData, eventsData] = await Promise.all([
      apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" }),
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
      apiRequest("/api/rides/events/recent?limit=50", { method: "GET" }),
    ]);
    state.payload = {
      rides: ridesData?.rides || [],
      drivers: driversData?.drivers || [],
      recentEvents: eventsData?.events || [],
      metrics: {
        rides: {
          avgAssignmentMs: calculateAvgAssignmentMs(ridesData?.rides || []),
        },
      },
    };
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudo cargar el dashboard.";
  } finally {
    state.loading = false;
  }
}

function calculateAvgAssignmentMs(rides) {
  let sum = 0;
  let count = 0;
  for (const ride of rides) {
    const requested = parseMs(ride.requestedAt);
    const accepted = parseMs(ride.acceptedAt);
    if (!requested || !accepted) continue;
    const diff = accepted - requested;
    if (diff >= 0 && diff <= 60 * 60 * 1000) {
      sum += diff;
      count += 1;
    }
  }
  return count ? Math.round(sum / count) : null;
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

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "-";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  if (n < 1000) return `${Math.round(n)} ms`;
  const sec = Math.round(n / 1000);
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  return `${min} min`;
}

function fmtCurrency(value) {
  return operationalSettings.formatCurrency(value);
}

function fmtTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortId(id) {
  if (!id) return "-";
  const s = String(id);
  return s.length > 8 ? s.slice(0, 8) : s;
}

const drivers = computed(() => state.payload?.drivers || []);
const rides = computed(() => state.payload?.rides || []);
const events = computed(() => state.payload?.recentEvents || []);
const metrics = computed(() => state.payload?.metrics || null);

const todaysRides = computed(() => rides.value.filter((ride) => isToday(ride.requestedAt)));
const activeRides = computed(() => rides.value.filter((ride) => !terminalStatuses.includes(ride.status)));
const onlineDrivers = computed(() => drivers.value.filter((driver) => driver.status === "online" || driver.status === "busy"));
const activeClients = computed(() => new Set(activeRides.value.map((ride) => ride.clientId).filter(Boolean)).size);
const canceledToday = computed(() =>
  todaysRides.value.filter((ride) => String(ride.status || "").startsWith("canceled") || ride.status === "no_show").length,
);
const completedToday = computed(() => todaysRides.value.filter((ride) => ride.status === "completed"));
const revenueToday = computed(() =>
  completedToday.value.reduce((sum, ride) => sum + Number(ride.finalFareAmount || ride.estimatedFareAmount || 0), 0),
);
const acceptanceRate = computed(() => {
  if (!todaysRides.value.length) return 0;
  const accepted = todaysRides.value.filter((ride) => Boolean(ride.acceptedAt || ride.driverId)).length;
  return Math.round((accepted / todaysRides.value.length) * 100);
});

const kpis = computed(() => [
  { label: "Servicios hoy", value: todaysRides.value.length, icon: Car, tone: "slate" },
  { label: "Servicios activos", value: activeRides.value.length, icon: TrendingUp, tone: "emerald" },
  { label: "Conductores online", value: onlineDrivers.value.length, icon: Users, tone: "blue" },
  { label: "Tasa de aceptación", value: `${acceptanceRate.value}%`, icon: Clock3, tone: "amber" },
  { label: "Clientes activos", value: activeClients.value, icon: Users, tone: "violet" },
  { label: "Asignación promedio", value: fmtMs(metrics.value?.rides?.avgAssignmentMs), icon: Clock3, tone: "slate" },
  { label: "Cancelaciones del día", value: canceledToday.value, icon: AlertTriangle, tone: "rose" },
  { label: "Ingresos del día", value: fmtCurrency(revenueToday.value), icon: DollarSign, tone: "emerald" },
]);

const operationalStatus = computed(() => {
  const counts = {
    pending: 0,
    assigned: 0,
    inProgress: 0,
    completed: 0,
    canceled: 0,
  };

  for (const ride of todaysRides.value) {
    if (ride.status === "pending_driver" || ride.status === "requested") counts.pending += 1;
    else if (ride.status === "driver_assigned" || ride.status === "driver_en_route" || ride.status === "driver_arrived") counts.assigned += 1;
    else if (ride.status === "in_progress") counts.inProgress += 1;
    else if (ride.status === "completed") counts.completed += 1;
    else if (String(ride.status || "").startsWith("canceled") || ride.status === "no_show") counts.canceled += 1;
  }

  return [
    ["Solicitudes Pendientes", counts.pending],
    ["Asignadas", counts.assigned],
    ["En Curso", counts.inProgress],
    ["Finalizadas", counts.completed],
    ["Canceladas", counts.canceled],
  ];
});

const servicesByType = computed(() => {
  const counts = new Map([
    ["Taxi", 0],
    ["Domicilio", 0],
    ["Baúl", 0],
    ["Despinchada", 0],
  ]);

  for (const ride of todaysRides.value) {
    const label = serviceLabels[ride.serviceType] || "Taxi";
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const max = Math.max(...counts.values(), 1);
  return Array.from(counts.entries()).map(([label, value]) => ({
    label,
    value,
    width: `${Math.max(6, (value / max) * 100)}%`,
  }));
});

const recentActivity = computed(() =>
  events.value.slice(0, 6).map((event) => ({
    time: fmtTime(event.occurredAt || event.updatedAt || event.requestedAt),
    label: `Servicio #${shortId(event.rideId)} ${event.status}`,
    meta: event.actorType ? `actor: ${event.actorType}` : "",
  })),
);

const topDrivers = computed(() => {
  const byDriver = new Map();
  for (const ride of completedToday.value) {
    if (!ride.driverId) continue;
    const current = byDriver.get(ride.driverId) || {
      id: ride.driverId,
      name: ride.driver?.fullName || [ride.driver?.firstName, ride.driver?.lastName].filter(Boolean).join(" ").trim() || ride.driver?.email || shortId(ride.driverId),
      count: 0,
    };
    current.count += 1;
    byDriver.set(ride.driverId, current);
  }
  return Array.from(byDriver.values()).sort((a, b) => b.count - a.count).slice(0, 5);
});

const alerts = computed(() => {
  const now = Date.now();
  const pendingLong = activeRides.value.filter((ride) => {
    if (!(ride.status === "pending_driver" || ride.status === "requested")) return false;
    const requested = parseMs(ride.requestedAt);
    return requested && now - requested > 5 * 60 * 1000;
  }).length;
  const noDriverActive = activeRides.value.length > 0 && onlineDrivers.value.length === 0;
  const gpsSilent = drivers.value.filter((driver) => {
    const updated = parseMs(driver.updatedAt);
    return updated && now - updated > 5 * 60 * 1000 && driver.status !== "offline";
  }).length;

  return [
    pendingLong ? `${pendingLong} solicitudes esperando más de 5 min` : "",
    noDriverActive ? "Servicios activos sin conductores online disponibles" : "",
    gpsSilent ? `${gpsSilent} conductores sin actualización reciente` : "",
  ].filter(Boolean);
});

const miniMapPoints = computed(() => {
  const rawPoints = [
    ...onlineDrivers.value
      .map((driver) => ({ key: `driver-${driver.userId}`, kind: "driver", location: driver.currentLocation }))
      .filter((point) => hasLocation(point.location))
      .slice(0, 10),
    ...activeRides.value
      .map((ride) => ({ key: `ride-${ride.id}`, kind: "request", location: ride.pickupLocation }))
      .filter((point) => hasLocation(point.location))
      .slice(0, 8),
  ];
  return projectMapPoints(rawPoints);
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
    ...point,
    left: `${16 + ((Number(point.location.lng) - minLng) / lngSpan) * 68}%`,
    top: `${16 + ((maxLat - Number(point.location.lat)) / latSpan) * 68}%`,
  }));
}

onMounted(async () => {
  await operationalSettings.fetchOperationalSettings();
  fetchDashboard();
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Dashboard</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Resumen General</h1>
        <p class="mt-1 text-sm text-slate-500">Panel de control operacional del día.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        :disabled="state.loading"
        type="button"
        @click="fetchDashboard"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="kpi in kpis" :key="kpi.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : kpi.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ kpi.label }}</div>
          </div>
          <div class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="kpi.icon" class="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Mapa resumido</h2>
            <p class="text-sm text-slate-500">Conductores, solicitudes y servicios activos.</p>
          </div>
          <RouterLink class="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-2.5 text-sm text-slate-700 hover:bg-slate-50" to="/admin/dashboard/mapa">
            <MapPinned class="h-4 w-4" />
            Abrir mapa completo
          </RouterLink>
        </div>

        <div class="relative h-72 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          <div class="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.28)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.28)_1px,transparent_1px)] bg-[size:32px_32px]"></div>
          <div
            v-for="point in miniMapPoints"
            :key="point.key"
            :class="[
              'absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-[11px] shadow-sm',
              point.kind === 'driver' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white',
            ]"
            :style="{ left: point.left, top: point.top }"
          >
            {{ point.kind === "driver" ? "T" : "P" }}
          </div>
          <div v-if="miniMapPoints.length === 0" class="absolute inset-0 grid place-items-center text-sm text-slate-500">
            Sin puntos activos
          </div>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <h2 class="text-base font-semibold text-slate-950">Estado operativo</h2>
          <div class="mt-3 grid gap-2">
            <div v-for="[label, value] in operationalStatus" :key="label" class="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span class="text-sm text-slate-600">{{ label }}</span>
              <span class="font-semibold text-slate-950">{{ value }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-white p-4">
          <h2 class="text-base font-semibold text-slate-950">Servicios por tipo</h2>
          <div class="mt-3 grid gap-3">
            <div v-for="service in servicesByType" :key="service.label">
              <div class="mb-1 flex items-center justify-between text-sm">
                <span class="text-slate-600">{{ service.label }}</span>
                <span class="font-semibold text-slate-950">{{ service.value }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100">
                <div class="h-full rounded-full bg-slate-950" :style="{ width: service.width }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-3">
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <h2 class="text-base font-semibold text-slate-950">Actividad reciente</h2>
        <div class="mt-3 grid gap-3">
          <div v-for="event in recentActivity" :key="`${event.time}-${event.label}`" class="flex gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
            <div class="w-12 shrink-0 font-mono text-sm text-slate-500">{{ event.time }}</div>
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-slate-900">{{ event.label }}</div>
              <div class="text-xs text-slate-500">{{ event.meta }}</div>
            </div>
          </div>
          <div v-if="recentActivity.length === 0" class="py-6 text-center text-sm text-slate-500">Sin actividad reciente.</div>
        </div>
      </div>

      <div class="rounded-md border border-slate-200 bg-white p-4">
        <h2 class="text-base font-semibold text-slate-950">Conductores destacados</h2>
        <div class="mt-3 grid gap-2">
          <div v-for="driver in topDrivers" :key="driver.id" class="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span class="truncate text-sm text-slate-700">{{ driver.name }}</span>
            <span class="text-sm font-semibold text-slate-950">{{ driver.count }} servicios</span>
          </div>
          <div v-if="topDrivers.length === 0" class="py-6 text-center text-sm text-slate-500">Sin servicios finalizados hoy.</div>
        </div>
      </div>

      <div class="rounded-md border border-slate-200 bg-white p-4">
        <h2 class="text-base font-semibold text-slate-950">Alertas operativas</h2>
        <div class="mt-3 grid gap-2">
          <div v-for="alert in alerts" :key="alert" class="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ alert }}</span>
          </div>
          <div v-if="alerts.length === 0" class="flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Operación sin alertas críticas
            <ArrowRight class="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
