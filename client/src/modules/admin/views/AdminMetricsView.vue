<script setup>
import {
  AlertTriangle,
  BarChart3,
  Car,
  CheckCircle2,
  Clock3,
  MapPinned,
  RefreshCw,
  UserCheck,
  XCircle,
} from "lucide-vue-next";
import { computed, onMounted, reactive } from "vue";
import { apiRequest } from "../../../services/api.js";

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

const activeStatusLabels = {
  requested: "Solicitadas",
  pending_driver: "Sin conductor",
  driver_assigned: "Asignadas",
  driver_en_route: "En camino",
  driver_arrived: "Conductor llegó",
  in_progress: "En curso",
};

const cancelLabels = {
  canceled_by_client: "Cliente",
  canceled_by_driver: "Conductor",
  canceled_by_system: "Sistema",
  no_show: "No show",
};

const state = reactive({
  loading: true,
  error: "",
  operations: null,
  hotZones: null,
  lastUpdatedAt: null,
});

function todayRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  return { from, to };
}

async function fetchMetrics() {
  state.loading = true;
  state.error = "";

  const { from, to } = todayRange();
  const zoneParams = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    status: "all",
    serviceType: "all",
  });

  try {
    const [ridesData, driversData, hotZones, eventsData] = await Promise.all([
      apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" }),
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
      apiRequest(`/api/admin/hot-zones?${zoneParams}`, { method: "GET" }),
      apiRequest("/api/rides/events/recent?limit=200", { method: "GET" }),
    ]);
    state.operations = {
      rides: ridesData?.rides || [],
      drivers: driversData?.drivers || [],
      recentEvents: eventsData?.events || [],
    };
    state.hotZones = hotZones;
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar las métricas.";
  } finally {
    state.loading = false;
  }
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
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

function formatPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n)}%` : "-";
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
}

const rides = computed(() => state.operations?.rides || []);
const drivers = computed(() => state.operations?.drivers || []);
const zones = computed(() => state.hotZones?.zones || []);

const todaysRides = computed(() => rides.value.filter((ride) => isToday(ride.requestedAt)));
const activeRides = computed(() => rides.value.filter((ride) => !terminalStatuses.includes(ride.status)));
const pendingTooLong = computed(() => {
  const now = Date.now();
  return activeRides.value.filter((ride) => {
    if (!["requested", "pending_driver"].includes(ride.status)) return false;
    const requested = parseMs(ride.requestedAt);
    return requested && now - requested > 5 * 60 * 1000;
  });
});

const availableDrivers = computed(() =>
  drivers.value.filter((driver) => driver.status === "online" && !driver.currentRideId),
);
const busyDrivers = computed(() =>
  drivers.value.filter((driver) => driver.status === "busy" || driver.currentRideId),
);
const staleDrivers = computed(() => {
  const now = Date.now();
  return drivers.value.filter((driver) => {
    if (driver.status === "offline") return false;
    const lastSeen = parseMs(driver.lastSeenAt || driver.updatedAt);
    return !lastSeen || now - lastSeen > 90_000;
  });
});

const acceptedToday = computed(() =>
  todaysRides.value.filter((ride) => Boolean(ride.acceptedAt || ride.driverId)),
);
const rejectedEventsToday = computed(() =>
  (state.operations?.recentEvents || []).filter((event) =>
    isToday(event.occurredAt) && event.payload?.response === "rejected",
  ),
);
const acceptanceRate = computed(() => {
  const attempts = acceptedToday.value.length + rejectedEventsToday.value.length;
  return attempts ? (acceptedToday.value.length / attempts) * 100 : null;
});

const avgAssignmentMs = computed(() => {
  let sum = 0;
  let count = 0;
  for (const ride of todaysRides.value) {
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
});

const activeStatusRows = computed(() => {
  const counts = new Map(Object.keys(activeStatusLabels).map((status) => [status, 0]));
  for (const ride of activeRides.value) {
    if (!counts.has(ride.status)) continue;
    counts.set(ride.status, counts.get(ride.status) + 1);
  }
  return Array.from(counts.entries()).map(([status, value]) => ({
    status,
    label: activeStatusLabels[status],
    value,
  }));
});

const cancellationRows = computed(() => {
  const counts = new Map(Object.keys(cancelLabels).map((status) => [status, 0]));
  for (const ride of todaysRides.value) {
    if (!counts.has(ride.status)) continue;
    counts.set(ride.status, counts.get(ride.status) + 1);
  }
  const max = Math.max(...counts.values(), 1);
  return Array.from(counts.entries()).map(([status, value]) => ({
    status,
    label: cancelLabels[status],
    value,
    width: `${Math.max(value ? 8 : 0, (value / max) * 100)}%`,
  }));
});

const zoneRows = computed(() => {
  const rows = zones.value.map((zone) => ({
    id: zone.id,
    name: zone.name,
    activeRequests: Number(zone.metrics?.activeRequests || 0),
    availableDrivers: Number(zone.metrics?.availableDrivers || 0),
    deficit: Number(zone.metrics?.deficit || 0),
    waitSeconds: Number(zone.metrics?.averageWaitSeconds || 0),
  }));
  return rows.sort((a, b) =>
    b.deficit - a.deficit || b.activeRequests - a.activeRequests || a.name.localeCompare(b.name),
  );
});

const maxZoneDemand = computed(() =>
  Math.max(...zoneRows.value.map((zone) => zone.activeRequests), 1),
);

const alerts = computed(() => {
  const items = [];
  if (pendingTooLong.value.length) {
    items.push({
      tone: "rose",
      label: `${pendingTooLong.value.length} solicitudes llevan más de 5 min sin conductor`,
    });
  }
  if (staleDrivers.value.length) {
    items.push({
      tone: "amber",
      label: `${staleDrivers.value.length} conductores tienen GPS sin actualización reciente`,
    });
  }
  const criticalZones = zoneRows.value.filter((zone) => zone.deficit > 0);
  if (criticalZones.length) {
    items.push({
      tone: "amber",
      label: `${criticalZones.length} zonas tienen más demanda que conductores disponibles`,
    });
  }
  if (acceptanceRate.value !== null && acceptanceRate.value < 50) {
    items.push({
      tone: "rose",
      label: "La tasa de aceptación está por debajo de 50%",
    });
  }
  return items;
});

const kpis = computed(() => [
  {
    label: "Solicitudes activas",
    value: activeRides.value.length,
    helper: `${pendingTooLong.value.length} sin conductor > 5 min`,
    icon: Car,
  },
  {
    label: "Conductores disponibles",
    value: availableDrivers.value.length,
    helper: `${busyDrivers.value.length} ocupados · ${staleDrivers.value.length} GPS stale`,
    icon: UserCheck,
  },
  {
    label: "Tiempo de asignación",
    value: formatDuration(avgAssignmentMs.value),
    helper: "Promedio de hoy",
    icon: Clock3,
  },
  {
    label: "Aceptación",
    value: formatPercent(acceptanceRate.value),
    helper: `${acceptedToday.value.length} aceptadas · ${rejectedEventsToday.value.length} rechazos`,
    icon: CheckCircle2,
  },
]);

onMounted(fetchMetrics);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Dashboard</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Métricas Operativas</h1>
        <p class="mt-1 text-sm text-slate-500">Indicadores prioritarios para demanda, capacidad y riesgo operativo.</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-sm text-slate-500">Actualizado: {{ formatTime(state.lastUpdatedAt) }}</span>
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          :disabled="state.loading"
          type="button"
          @click="fetchMetrics"
        >
          <RefreshCw class="h-4 w-4" />
          Actualizar
        </button>
      </div>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div v-for="kpi in kpis" :key="kpi.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : kpi.value }}</div>
            <div class="mt-1 text-sm font-medium text-slate-700">{{ kpi.label }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ state.loading ? "Cargando..." : kpi.helper }}</div>
          </div>
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="kpi.icon" class="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Demanda por zona</h2>
            <p class="text-sm text-slate-500">Solicitudes activas contra conductores disponibles.</p>
          </div>
          <MapPinned class="h-5 w-5 text-slate-400" />
        </div>

        <div class="grid gap-3">
          <div v-for="zone in zoneRows" :key="zone.id" class="rounded-md border border-slate-100 p-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-slate-950">{{ zone.name }}</div>
                <div class="mt-1 text-xs text-slate-500">
                  {{ zone.activeRequests }} activas · {{ zone.availableDrivers }} conductores · espera {{ formatDuration(zone.waitSeconds * 1000) }}
                </div>
              </div>
              <span :class="['rounded-md px-2 py-1 text-xs font-semibold', zone.deficit > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700']">
                Déficit {{ zone.deficit }}
              </span>
            </div>
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-slate-950" :style="{ width: `${Math.max(zone.activeRequests ? 8 : 0, (zone.activeRequests / maxZoneDemand) * 100)}%` }"></div>
            </div>
          </div>
          <div v-if="!state.loading && zoneRows.length === 0" class="py-8 text-center text-sm text-slate-500">No hay datos de zonas.</div>
        </div>
      </div>

      <div class="grid gap-4">
        <div class="rounded-md border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-base font-semibold text-slate-950">Estados activos</h2>
            <BarChart3 class="h-5 w-5 text-slate-400" />
          </div>
          <div class="grid gap-2">
            <div v-for="row in activeStatusRows" :key="row.status" class="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
              <span class="text-sm text-slate-600">{{ row.label }}</span>
              <span class="font-semibold text-slate-950">{{ row.value }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-base font-semibold text-slate-950">Alertas</h2>
            <AlertTriangle class="h-5 w-5 text-slate-400" />
          </div>
          <div class="grid gap-2">
            <div
              v-for="alert in alerts"
              :key="alert.label"
              :class="['rounded-md border px-3 py-2 text-sm', alert.tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900']"
            >
              {{ alert.label }}
            </div>
            <div v-if="!alerts.length" class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Operación sin alertas críticas.
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Aceptación y rechazo</h2>
            <p class="text-sm text-slate-500">Relación entre servicios aceptados y rechazos registrados hoy.</p>
          </div>
          <CheckCircle2 class="h-5 w-5 text-slate-400" />
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-md bg-emerald-50 p-3">
            <div class="text-2xl font-semibold text-emerald-800">{{ acceptedToday.length }}</div>
            <div class="text-sm text-emerald-700">Aceptadas</div>
          </div>
          <div class="rounded-md bg-rose-50 p-3">
            <div class="text-2xl font-semibold text-rose-800">{{ rejectedEventsToday.length }}</div>
            <div class="text-sm text-rose-700">Rechazos</div>
          </div>
          <div class="rounded-md bg-slate-50 p-3">
            <div class="text-2xl font-semibold text-slate-950">{{ formatPercent(acceptanceRate) }}</div>
            <div class="text-sm text-slate-600">Tasa</div>
          </div>
        </div>
      </div>

      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Cancelaciones</h2>
            <p class="text-sm text-slate-500">Distribución de cancelaciones del día.</p>
          </div>
          <XCircle class="h-5 w-5 text-slate-400" />
        </div>
        <div class="grid gap-3">
          <div v-for="row in cancellationRows" :key="row.status">
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="text-slate-600">{{ row.label }}</span>
              <span class="font-semibold text-slate-950">{{ row.value }}</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-rose-500" :style="{ width: row.width }"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
