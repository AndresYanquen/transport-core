<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, CheckCircle2, Clock3, Copy, History, RefreshCw, Repeat2, Search, UserPlus } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const tabs = [
  { key: "manual", slug: "manuales", label: "Manuales" },
  { key: "reassignments", slug: "reasignaciones", label: "Reasignaciones" },
  { key: "history", slug: "historial", label: "Historial" },
];

const tabAliases = {
  manuales: "manual",
  reasignaciones: "reassignments",
  historial: "history",
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
  canceled_by_system: { label: "Cancelada sistema", class: "border-rose-200 bg-rose-50 text-rose-700" },
  no_show: { label: "No show", class: "border-orange-200 bg-orange-50 text-orange-700" },
};

const state = reactive({
  loading: true,
  error: "",
  rides: [],
  drivers: [],
  lastUpdatedAt: null,
  toast: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

let socket = null;
let refreshTimer = null;
let toastTimer = null;

function normalizeTab(value) {
  return tabs.some((tab) => tab.key === value) ? value : "manual";
}

function resolveRouteTab() {
  const viewParam = Array.isArray(route.params.assignmentView)
    ? route.params.assignmentView[0]
    : route.params.assignmentView;
  const fromParam = tabAliases[String(viewParam || "").toLowerCase()];
  return fromParam || normalizeTab(String(route.query.vista || "manual"));
}

async function fetchAssignments({ quiet = false } = {}) {
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
    state.error = err?.message || "No se pudieron cargar las asignaciones.";
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchAssignments({ quiet: true }));
}

function setTab(tabKey) {
  const normalized = normalizeTab(tabKey);
  const tab = tabs.find((item) => item.key === normalized) || tabs[0];
  filters.tab = normalized;
  router.replace(`/admin/operacion/asignaciones/${tab.slug}`);
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
      showToast("ID de solicitud copiado");
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
    showToast("ID de solicitud copiado");
  } catch (err) {
    showToast("No se pudo copiar el ID", "error");
  }
}

function showToast(message, type = "success") {
  state.toast = { message, type };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    toastTimer = null;
  }, 2200);
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

function personName(person) {
  const contact = person?.contact || person;
  if (contact?.fullName) return contact.fullName;
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return name || contact?.email || "-";
}

function statusLabel(status) {
  return statusMeta[status]?.label || status || "-";
}

function statusClass(status) {
  return statusMeta[status]?.class || "border-slate-200 bg-white text-slate-600";
}

const driversById = computed(() => new Map(state.drivers.map((driver) => [driver.userId, driver])));

function ridePassenger(ride) {
  return ride.passenger || ride.client || null;
}

function rideDriver(ride) {
  return ride.driver || driversById.value.get(ride.driverId) || null;
}

function matchesSearch(ride) {
  const query = filters.search.trim().toLowerCase();
  if (!query) return true;
  return [
    ride.id,
    ride.status,
    ride.serviceType,
    ride.pickupAddress,
    ridePassenger(ride)?.email,
    ridePassenger(ride)?.firstName,
    ridePassenger(ride)?.lastName,
    ridePassenger(ride)?.fullName,
    rideDriver(ride)?.contact?.email,
    rideDriver(ride)?.contact?.firstName,
    rideDriver(ride)?.contact?.lastName,
    rideDriver(ride)?.email,
    rideDriver(ride)?.firstName,
    rideDriver(ride)?.lastName,
  ].filter(Boolean).join(" ").toLowerCase().includes(query);
}

const activeTab = computed(() => tabs.find((tab) => tab.key === filters.tab) || tabs[0]);

const manualAssignments = computed(() =>
  state.rides
    .filter((ride) => ["requested", "pending_driver"].includes(ride.status) && !ride.driverId)
    .filter(matchesSearch)
    .sort((a, b) => new Date(a.requestedAt || 0) - new Date(b.requestedAt || 0)),
);

const reassignments = computed(() =>
  state.rides
    .filter((ride) => ["driver_assigned", "driver_en_route", "driver_arrived", "in_progress"].includes(ride.status))
    .filter(matchesSearch)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
);

const assignmentEvents = computed(() => {
  const query = filters.search.trim().toLowerCase();
  return state.rides
    .filter((ride) => ride.driverId || ride.acceptedAt)
    .map((ride) => ({
      id: `${ride.id}-${ride.updatedAt || ride.acceptedAt || ride.requestedAt}`,
      rideId: ride.id,
      status: ride.status,
      actorType: ride.driverId ? "driver" : "system",
      occurredAt: ride.acceptedAt || ride.updatedAt || ride.requestedAt,
      detail: ride.driverId ? `Conductor ${personName(rideDriver(ride))}` : "Asignación automática",
    }))
    .filter((event) => {
      if (!query) return true;
      return [event.rideId, event.status, event.actorType, event.detail]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
});

const currentRows = computed(() => {
  if (activeTab.value.key === "reassignments") return reassignments.value;
  if (activeTab.value.key === "history") return assignmentEvents.value;
  return manualAssignments.value;
});

const summary = computed(() => [
  { label: "Manuales", value: manualAssignments.value.length, icon: UserPlus },
  { label: "Reasignaciones", value: reassignments.value.length, icon: Repeat2 },
  { label: "Eventos", value: assignmentEvents.value.length, icon: History },
  {
    label: "Espera > 5 min",
    value: manualAssignments.value.filter((ride) => {
      const requested = new Date(ride.requestedAt || 0).getTime();
      return Number.isFinite(requested) && Date.now() - requested > 5 * 60 * 1000;
    }).length,
    icon: Clock3,
  },
]);

watch(() => [route.params.assignmentView, route.query.vista], () => {
  filters.tab = resolveRouteTab();
});

onMounted(async () => {
  filters.tab = resolveRouteTab();
  await fetchAssignments();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchAssignments({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  socket?.disconnect();
  socket = null;
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-1 opacity-0"
    >
      <div
        v-if="state.toast"
        :class="[
          'fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium shadow-lg',
          state.toast.type === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800',
        ]"
        role="status"
      >
        <CheckCircle2 v-if="state.toast.type !== 'error'" class="h-4 w-4" />
        <AlertTriangle v-else class="h-4 w-4" />
        {{ state.toast.message }}
      </div>
    </Transition>

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Operación</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Asignaciones</h1>
        <p class="mt-1 text-sm text-slate-500">Control de asignación manual, reasignación y eventos recientes.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchAssignments"
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
              placeholder="Buscar solicitud, cliente, conductor o estado"
            />
          </label>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'h-9 rounded-md px-3 text-sm font-medium',
              activeTab.key === tab.key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ]"
            type="button"
            @click="setTab(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div v-if="activeTab.key !== 'history'" class="overflow-auto">
        <table class="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Solicitud</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Cliente</th>
              <th class="py-2 pr-3">Conductor actual</th>
              <th class="py-2 pr-3">Origen</th>
              <th class="py-2 pr-3">Espera</th>
              <th class="py-2 pr-4">Servicio</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ride in currentRows" :key="ride.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="flex items-center gap-1.5">
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
                <div class="mt-1 text-xs text-slate-500">{{ formatDate(ride.requestedAt) }}</div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', statusClass(ride.status)]">
                  {{ statusLabel(ride.status) }}
                </span>
              </td>
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ personName(ridePassenger(ride)) }}</div>
                <div class="text-xs text-slate-500">{{ ridePassenger(ride)?.email || "-" }}</div>
              </td>
              <td class="py-3 pr-3">
                <template v-if="rideDriver(ride)">
                  <div class="font-medium text-slate-950">{{ personName(rideDriver(ride)) }}</div>
                  <div class="text-xs text-slate-500">{{ rideDriver(ride)?.contact?.email || rideDriver(ride)?.email || "-" }}</div>
                </template>
                <span v-else class="text-slate-400">Sin asignar</span>
              </td>
              <td class="max-w-[280px] truncate py-3 pr-3" :title="ride.pickupAddress">{{ ride.pickupAddress || "-" }}</td>
              <td class="py-3 pr-3">{{ formatAge(ride.requestedAt) }}</td>
              <td class="py-3 pr-4">
                <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{{ ride.serviceType || "-" }}</span>
              </td>
            </tr>
            <tr v-if="!state.loading && currentRows.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="7">No hay registros para esta vista.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="7">Cargando asignaciones...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="overflow-auto">
        <table class="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Hora</th>
              <th class="py-2 pr-3">Solicitud</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Actor</th>
              <th class="py-2 pr-4">Detalle</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in currentRows" :key="event.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">{{ formatDate(event.occurredAt) }}</td>
              <td class="py-3 pr-3">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs">#{{ shortId(event.rideId) }}</span>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID de solicitud"
                    aria-label="Copiar ID de solicitud"
                    @click="copyText(event.rideId)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', statusClass(event.status)]">
                  {{ statusLabel(event.status) }}
                </span>
              </td>
              <td class="py-3 pr-3">{{ event.actorType || "-" }}</td>
              <td class="py-3 pr-4 text-xs text-slate-600">
                <span>{{ event.detail || "-" }}</span>
              </td>
            </tr>
            <tr v-if="!state.loading && currentRows.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="5">No hay historial de asignación.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="5">Cargando historial...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
