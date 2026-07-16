<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, Ban, Clock3, Copy, FileText, RefreshCw, Search, ShieldAlert } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const tabs = [
  { key: "reports", slug: "reportes", label: "Reportes", icon: FileText },
  { key: "complaints", slug: "quejas", label: "Quejas", icon: Ban },
  { key: "special_cases", slug: "casos-especiales", label: "Casos Especiales", icon: ShieldAlert },
];

const tabAliases = {
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
  rides: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

let socket = null;
let refreshTimer = null;

function normalizeTab(value) {
  return tabs.some((tab) => tab.key === value) ? value : "reports";
}

function resolveRouteTab() {
  const viewParam = Array.isArray(route.params.incidentView)
    ? route.params.incidentView[0]
    : route.params.incidentView;
  return tabAliases[String(viewParam || "").toLowerCase()] || normalizeTab(String(route.query.vista || "reports"));
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

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchIncidents({ quiet: true }));
}

function setTab(tabKey) {
  const normalized = normalizeTab(tabKey);
  const tab = tabs.find((item) => item.key === normalized) || tabs[0];
  filters.tab = normalized;
  router.replace(`/admin/operacion/incidentes/${tab.slug}`);
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

const summary = computed(() => [
  { label: "Reportes", value: reports.value.length, icon: FileText },
  { label: "Quejas", value: complaints.value.length, icon: Ban },
  { label: "Casos especiales", value: specialCases.value.length, icon: ShieldAlert },
  { label: "Espera > 10 min", value: state.rides.filter(isLongWait).length, icon: Clock3 },
]);

watch(() => [route.params.incidentView, route.query.vista], () => {
  filters.tab = resolveRouteTab();
});

onMounted(() => {
  filters.tab = resolveRouteTab();
  fetchIncidents();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchIncidents({ quiet: true }), 30000);
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
        <p class="mt-1 text-sm text-slate-500">Reportes, quejas y casos especiales derivados de viajes reales.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchIncidents"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              {{ currentRows.length }} visibles
              <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span>
            </p>
          </div>
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar solicitud, cliente, conductor o dirección"
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

      <div class="overflow-auto">
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
