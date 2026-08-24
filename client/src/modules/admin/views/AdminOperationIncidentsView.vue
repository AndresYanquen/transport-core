<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, Ban, CheckCircle2, Clock3, Copy, FileText, History, RefreshCw, Search, ShieldAlert } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";
import { useDriverNotificationsStore } from "../../../stores/driverNotifications.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const driverNotifications = useDriverNotificationsStore();

const tabs = [
  { key: "history", slug: "", label: "Historial", icon: History },
  { key: "panic", slug: "panico", label: "Pánico", icon: AlertTriangle },
  { key: "reports", slug: "reportes", label: "Reportes", icon: FileText },
  { key: "complaints", slug: "quejas", label: "Quejas", icon: Ban },
  { key: "special_cases", slug: "casos-especiales", label: "Casos Especiales", icon: ShieldAlert },
];

const tabAliases = {
  historial: "history",
  panico: "panic",
  reportes: "reports",
  quejas: "complaints",
  "casos-especiales": "special_cases",
};

const statusMeta = {
  requested: { label: "Solicitada", class: "border-sky-200 bg-sky-50 text-sky-700" },
  pending_driver: { label: "Buscando conductor", class: "border-amber-200 bg-amber-50 text-amber-800" },
  driver_assigned: { label: "Asignada", class: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  driver_en_route: { label: "En camino", class: "border-blue-200 bg-blue-50 text-blue-800" },
  driver_arrived: { label: "Conductor llegó", class: "border-violet-200 bg-violet-50 text-violet-800" },
  in_progress: { label: "En curso", class: "border-slate-300 bg-slate-100 text-slate-800" },
  completed: { label: "Finalizada", class: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  canceled_by_client: { label: "Cancelada cliente", class: "border-rose-200 bg-rose-50 text-rose-700" },
  canceled_by_driver: { label: "Cancelada conductor", class: "border-rose-200 bg-rose-50 text-rose-700" },
  canceled_by_system: { label: "Cancelada sistema", class: "border-red-200 bg-red-50 text-red-700" },
  no_show: { label: "No show", class: "border-orange-200 bg-orange-50 text-orange-700" },
};

const state = reactive({
  loading: true,
  error: "",
  notificationError: "",
  rides: [],
  panicAlerts: [],
  notificationActionId: "",
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

let socket = null;
let refreshTimer = null;

function normalizeTab(value) {
  return tabs.some((tab) => tab.key === value) ? value : "history";
}

function resolveRouteTab() {
  const viewParam = Array.isArray(route.params.incidentView)
    ? route.params.incidentView[0]
    : route.params.incidentView;
  const routeTab = tabAliases[String(viewParam || "").toLowerCase()] || String(route.query.vista || "");
  return normalizeTab(routeTab || "history");
}

async function fetchIncidents({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" });
    state.rides = data?.rides || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar los incidentes.";
  } finally {
    state.loading = false;
  }
}

async function fetchPanicAlerts({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.notificationError = "";

  try {
    const responses = await Promise.all(
      ["unread", "acknowledged", "resolved"].map((status) =>
        apiRequest(`/api/driver-notifications?status=${status}&type=panic&limit=200`, { method: "GET" }),
      ),
    );
    const deduped = new Map();
    responses.flatMap((data) => data?.notifications || []).forEach((notification) => {
      if (notification?.id) deduped.set(notification.id, notification);
    });
    state.panicAlerts = [...deduped.values()].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
    state.lastUpdatedAt = new Date().toISOString();
    driverNotifications.refreshUnreadPanicCount().catch(() => {});
  } catch (err) {
    state.notificationError = err?.message || "No se pudieron cargar las alertas de pánico.";
  } finally {
    state.loading = false;
  }
}

async function refreshAll(options = {}) {
  await Promise.all([fetchIncidents(options), fetchPanicAlerts(options)]);
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchIncidents({ quiet: true }));
  socket.on("operations:driver-panic-created", () => fetchPanicAlerts({ quiet: true }));
  socket.on("operations:driver-notification-acknowledged", () => fetchPanicAlerts({ quiet: true }));
  socket.on("operations:driver-notification-resolved", () => fetchPanicAlerts({ quiet: true }));
}

function setTab(tabKey) {
  const normalized = normalizeTab(tabKey);
  const tab = tabs.find((item) => item.key === normalized) || tabs[0];
  filters.tab = normalized;
  const prefix = String(auth.state.user?.role || "").toLowerCase() === "operator"
    ? "/operator/operacion/incidentes"
    : "/admin/operacion/incidentes";
  router.replace(tab.slug ? `${prefix}/${tab.slug}` : prefix);
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

async function copyText(value) {
  const text = String(value || "");
  if (!text) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (_err) {
    state.error = "No se pudo copiar el ID de la solicitud.";
  }
}

function personName(person) {
  if (person?.fullName) return person.fullName;
  const name = [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim();
  return name || person?.email || "-";
}

function notificationDriverName(notification) {
  return personName(notification?.driver);
}

function notificationLocation(notification) {
  const location = notification?.metadata?.location;
  if (!location) return "-";
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "-";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function notificationStatusLabel(status) {
  if (status === "unread") return "Sin reconocer";
  if (status === "acknowledged") return "Reconocida";
  if (status === "resolved") return "Resuelta";
  return status || "-";
}

function notificationStatusClass(status) {
  if (status === "unread") return "border-red-200 bg-red-50 text-red-700";
  if (status === "acknowledged") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-white text-slate-600";
}

async function acknowledgeAlert(notification) {
  if (!notification?.id) return;
  state.notificationActionId = notification.id;
  state.notificationError = "";

  try {
    await apiRequest(`/api/driver-notifications/${notification.id}/acknowledge`, { method: "PATCH" });
    await fetchPanicAlerts({ quiet: true });
  } catch (err) {
    state.notificationError = err?.message || "No se pudo reconocer la alerta.";
  } finally {
    state.notificationActionId = "";
  }
}

async function resolveAlert(notification) {
  if (!notification?.id) return;
  state.notificationActionId = notification.id;
  state.notificationError = "";

  try {
    await apiRequest(`/api/driver-notifications/${notification.id}/resolve`, { method: "PATCH" });
    await fetchPanicAlerts({ quiet: true });
  } catch (err) {
    state.notificationError = err?.message || "No se pudo resolver la alerta.";
  } finally {
    state.notificationActionId = "";
  }
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

function statusLabel(status) {
  return statusMeta[status]?.label || status || "-";
}

function statusClass(status) {
  return statusMeta[status]?.class || "border-slate-200 bg-white text-slate-600";
}

function incidentType(ride) {
  if (ride.status === "no_show") return "No show";
  if (ride.status === "canceled_by_client") return "Queja cliente";
  if (ride.status === "canceled_by_driver") return "Reporte conductor";
  if (ride.status === "canceled_by_system") return "Caso sistema";
  if (isLongWait(ride)) return "Espera alta";
  return "Seguimiento";
}

function isLongWait(ride) {
  if (!["requested", "pending_driver"].includes(ride.status)) return false;
  const requested = new Date(ride.requestedAt || 0).getTime();
  return Number.isFinite(requested) && Date.now() - requested > 10 * 60 * 1000;
}

function incidentTimestamp(ride) {
  return ride.updatedAt || ride.canceledAt || ride.completedAt || ride.requestedAt || ride.createdAt;
}

function rideIncidentDetail(ride) {
  if (ride.cancellationReason) return ride.cancellationReason;
  if (isLongWait(ride)) return "Solicitud pendiente por más de 10 minutos.";
  return ride.dropoffAddress || "Sin detalle adicional";
}

function matchesSearch(ride) {
  const query = filters.search.trim().toLowerCase();
  if (!query) return true;
  return [
    ride.id,
    ride.status,
    ride.serviceType,
    ride.pickupAddress,
    ride.dropoffAddress,
    ride.cancellationReason,
    ride.passenger?.email,
    ride.passenger?.firstName,
    ride.passenger?.lastName,
    ride.passenger?.fullName,
    ride.driver?.email,
    ride.driver?.firstName,
    ride.driver?.lastName,
    ride.driver?.fullName,
  ].filter(Boolean).join(" ").toLowerCase().includes(query);
}

const activeTab = computed(() => tabs.find((tab) => tab.key === filters.tab) || tabs[0]);

const reports = computed(() =>
  state.rides.filter((ride) => ["canceled_by_driver", "no_show"].includes(ride.status) || isLongWait(ride)),
);

const complaints = computed(() =>
  state.rides.filter((ride) => ride.status === "canceled_by_client"),
);

const specialCases = computed(() =>
  state.rides.filter((ride) => ride.status === "canceled_by_system" || ride.status === "no_show"),
);

const rideIncidentRows = computed(() => {
  const rows = state.rides.filter((ride) =>
    ["canceled_by_driver", "canceled_by_client", "canceled_by_system", "no_show"].includes(ride.status) || isLongWait(ride),
  );

  return rows.map((ride) => ({
    id: ride.id,
    kind: "ride",
    type: incidentType(ride),
    status: statusLabel(ride.status),
    statusClass: statusClass(ride.status),
    primary: personName(ride.driver) !== "-" ? personName(ride.driver) : personName(ride.passenger),
    secondary: personName(ride.passenger),
    location: ride.pickupAddress || "-",
    detail: rideIncidentDetail(ride),
    createdAt: incidentTimestamp(ride),
    ride,
  }));
});

const panicHistoryRows = computed(() =>
  state.panicAlerts.map((notification) => ({
    id: notification.id,
    kind: "panic",
    type: "Pánico",
    status: notificationStatusLabel(notification.status),
    statusClass: notificationStatusClass(notification.status),
    primary: notificationDriverName(notification),
    secondary: notification.driver?.email || notification.driver?.phoneNumber || "-",
    location: notificationLocation(notification),
    detail: notification.message || "Alerta de pánico enviada por conductor.",
    createdAt: notification.createdAt,
    notification,
  })),
);

function matchesHistorySearch(row) {
  const query = filters.search.trim().toLowerCase();
  if (!query) return true;

  const source = row.kind === "panic"
    ? [
      row.id,
      row.type,
      row.status,
      row.primary,
      row.secondary,
      row.location,
      row.detail,
      row.notification?.rideId,
      row.notification?.driver?.phoneNumber,
    ]
    : [
      row.id,
      row.type,
      row.status,
      row.primary,
      row.secondary,
      row.location,
      row.detail,
      row.ride?.status,
      row.ride?.serviceType,
      row.ride?.dropoffAddress,
      row.ride?.passenger?.email,
      row.ride?.driver?.email,
    ];

  return source.filter(Boolean).join(" ").toLowerCase().includes(query);
}

const currentHistoryRows = computed(() =>
  [...panicHistoryRows.value, ...rideIncidentRows.value]
    .filter(matchesHistorySearch)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
);

const currentRows = computed(() => {
  const rows = activeTab.value.key === "complaints"
    ? complaints.value
    : activeTab.value.key === "special_cases"
      ? specialCases.value
      : reports.value;
  return rows.filter(matchesSearch).sort((a, b) =>
    new Date(b.updatedAt || b.canceledAt || b.requestedAt || 0).getTime()
    - new Date(a.updatedAt || a.canceledAt || a.requestedAt || 0).getTime(),
  );
});

const currentPanicAlerts = computed(() => {
  const query = filters.search.trim().toLowerCase();
  const rows = query
    ? state.panicAlerts.filter((notification) => [
      notification.id,
      notification.message,
      notification.rideId,
      notification.status,
      notificationDriverName(notification),
      notification.driver?.email,
      notification.driver?.phoneNumber,
      notificationLocation(notification),
    ].filter(Boolean).join(" ").toLowerCase().includes(query))
    : state.panicAlerts;

  return rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
});

const summary = computed(() => [
  { label: "Historial", value: currentHistoryRows.value.length, icon: History },
  { label: "Alertas de pánico", value: state.panicAlerts.length, icon: AlertTriangle },
  { label: "Reportes", value: reports.value.length, icon: FileText },
  { label: "Quejas", value: complaints.value.length, icon: Ban },
  { label: "Casos especiales", value: specialCases.value.length, icon: ShieldAlert },
]);

watch(() => [route.params.incidentView, route.query.vista], () => {
  filters.tab = resolveRouteTab();
});

onMounted(() => {
  filters.tab = resolveRouteTab();
  refreshAll();
  connectRealtime();
  refreshTimer = window.setInterval(() => refreshAll({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  socket?.disconnect();
  socket = null;
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Operación</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Incidentes</h1>
        <p class="mt-1 text-sm text-slate-500">Historial, alertas de pánico, reportes, quejas y casos especiales.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="refreshAll"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>
    <div v-if="state.notificationError" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.notificationError }}
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <div v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
          </div>
          <div class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="item.icon" class="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white">
      <div class="border-b border-slate-200 p-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-slate-950">{{ activeTab.label }}</h2>
            <p class="text-sm text-slate-500">
              {{
                activeTab.key === "history"
                  ? currentHistoryRows.length
                  : activeTab.key === "panic"
                    ? currentPanicAlerts.length
                    : currentRows.length
              }} visibles
              <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span>
            </p>
          </div>
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar incidente, cliente, conductor o dirección"
            />
          </label>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium',
              activeTab.key === tab.key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ]"
            type="button"
            @click="setTab(tab.key)"
          >
            <component :is="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div v-if="activeTab.key === 'history'" class="overflow-auto">
        <table class="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Fecha</th>
              <th class="py-2 pr-3">Tipo</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Responsable</th>
              <th class="py-2 pr-3">Referencia</th>
              <th class="py-2 pr-3">Ubicación</th>
              <th class="py-2 pr-4">Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in currentHistoryRows" :key="`${row.kind}-${row.id}`" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="font-medium text-slate-950">{{ formatDate(row.createdAt) }}</div>
                <div class="text-xs text-slate-500">{{ formatAge(row.createdAt) }}</div>
              </td>
              <td class="py-3 pr-3">
                <span
                  :class="[
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium',
                    row.kind === 'panic'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-900',
                  ]"
                >
                  <AlertTriangle v-if="row.kind === 'panic'" class="h-3.5 w-3.5" />
                  <FileText v-else class="h-3.5 w-3.5" />
                  {{ row.type }}
                </span>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', row.statusClass]">
                  {{ row.status }}
                </span>
              </td>
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ row.primary }}</div>
                <div class="text-xs text-slate-500">{{ row.secondary }}</div>
              </td>
              <td class="py-3 pr-3">
                <div class="flex items-center gap-1">
                  <span class="font-mono text-xs font-medium text-slate-950">#{{ shortId(row.id) }}</span>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID"
                    aria-label="Copiar ID"
                    @click="copyText(row.id)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
                <div v-if="row.kind === 'panic'" class="mt-1 text-xs text-slate-500">Alerta de conductor</div>
                <div v-else class="mt-1 text-xs text-slate-500">Servicio</div>
              </td>
              <td class="max-w-[260px] truncate py-3 pr-3" :title="row.location">
                <span :class="row.kind === 'panic' ? 'font-mono text-xs' : ''">{{ row.location }}</span>
              </td>
              <td class="max-w-[320px] truncate py-3 pr-4" :title="row.detail">
                {{ row.detail }}
              </td>
            </tr>
            <tr v-if="!state.loading && currentHistoryRows.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="7">No hay historial de incidentes.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="7">Cargando historial...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="activeTab.key === 'panic'" class="overflow-auto">
        <table class="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Alerta</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Conductor</th>
              <th class="py-2 pr-3">Teléfono</th>
              <th class="py-2 pr-3">Ubicación</th>
              <th class="py-2 pr-3">Viaje</th>
              <th class="py-2 pr-3">Tiempo</th>
              <th class="py-2 pr-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="notification in currentPanicAlerts" :key="notification.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="flex items-center gap-1">
                  <span class="font-mono text-xs font-medium text-slate-950">#{{ shortId(notification.id) }}</span>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID de alerta"
                    aria-label="Copiar ID de alerta"
                    @click="copyText(notification.id)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
                <div class="mt-1 max-w-[260px] truncate text-xs text-slate-500" :title="notification.message">
                  {{ notification.message }}
                </div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', notificationStatusClass(notification.status)]">
                  {{ notificationStatusLabel(notification.status) }}
                </span>
              </td>
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ notificationDriverName(notification) }}</div>
                <div class="text-xs text-slate-500">{{ notification.driver?.email || "-" }}</div>
              </td>
              <td class="py-3 pr-3">{{ notification.driver?.phoneNumber || "-" }}</td>
              <td class="py-3 pr-3">
                <span class="font-mono text-xs">{{ notificationLocation(notification) }}</span>
              </td>
              <td class="py-3 pr-3">
                <span class="font-mono text-xs">{{ shortId(notification.rideId) }}</span>
              </td>
              <td class="py-3 pr-3">
                <div>{{ formatAge(notification.createdAt) }}</div>
                <div class="text-xs text-slate-500">{{ formatDate(notification.createdAt) }}</div>
              </td>
              <td class="py-3 pr-4">
                <div class="flex justify-end gap-2">
                  <button
                    class="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    :disabled="notification.status !== 'unread' || state.notificationActionId === notification.id"
                    type="button"
                    @click="acknowledgeAlert(notification)"
                  >
                    <CheckCircle2 class="h-3.5 w-3.5" />
                    Reconocer
                  </button>
                  <button
                    class="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-950 px-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    :disabled="notification.status === 'resolved' || state.notificationActionId === notification.id"
                    type="button"
                    @click="resolveAlert(notification)"
                  >
                    Resolver
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!state.loading && currentPanicAlerts.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="8">No hay alertas de pánico activas.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="8">Cargando alertas...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="overflow-auto">
        <table class="w-full min-w-[1120px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Caso</th>
              <th class="py-2 pr-3">Tipo</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Cliente</th>
              <th class="py-2 pr-3">Conductor</th>
              <th class="py-2 pr-3">Origen</th>
              <th class="py-2 pr-3">Tiempo</th>
              <th class="py-2 pr-4">Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ride in currentRows" :key="`${activeTab.key}-${ride.id}`" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="flex items-center gap-1">
                  <span class="font-mono text-xs font-medium text-slate-950">#{{ shortId(ride.id) }}</span>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID de solicitud"
                    aria-label="Copiar ID de solicitud"
                    @click="copyText(ride.id)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
                <div class="mt-1 text-xs text-slate-500">{{ formatDate(ride.updatedAt || ride.canceledAt || ride.requestedAt) }}</div>
              </td>
              <td class="py-3 pr-3">
                <span class="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                  <AlertTriangle class="h-3.5 w-3.5" />
                  {{ incidentType(ride) }}
                </span>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', statusClass(ride.status)]">
                  {{ statusLabel(ride.status) }}
                </span>
              </td>
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ personName(ride.passenger) }}</div>
                <div class="text-xs text-slate-500">{{ ride.passenger?.email || "-" }}</div>
              </td>
              <td class="py-3 pr-3">
                <template v-if="ride.driver">
                  <div class="font-medium text-slate-950">{{ personName(ride.driver) }}</div>
                  <div class="text-xs text-slate-500">{{ ride.driver.email || "-" }}</div>
                </template>
                <span v-else class="text-slate-400">Sin asignar</span>
              </td>
              <td class="max-w-[260px] truncate py-3 pr-3" :title="ride.pickupAddress">
                {{ ride.pickupAddress || "-" }}
              </td>
              <td class="py-3 pr-3">
                {{ ride.canceledAt ? formatDate(ride.canceledAt) : formatAge(ride.requestedAt) }}
              </td>
              <td class="max-w-[280px] truncate py-3 pr-4" :title="ride.cancellationReason || ride.dropoffAddress || ''">
                {{ ride.cancellationReason || ride.dropoffAddress || "Sin detalle adicional" }}
              </td>
            </tr>
            <tr v-if="!state.loading && currentRows.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="8">No hay registros para esta vista.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="8">Cargando incidentes...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
