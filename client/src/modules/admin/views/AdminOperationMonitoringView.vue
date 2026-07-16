<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Car, Clock3, Copy, MapPin, RefreshCw, Search, UserRound, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

const tabs = [
  { key: "active_rides", slug: "viajes-activos", label: "Viajes Activos", icon: MapPin },
  { key: "online_drivers", slug: "conductores-online", label: "Conductores Online", icon: Car },
  { key: "active_customers", slug: "clientes-activos", label: "Clientes Activos", icon: Users },
];

const tabAliases = {
  "viajes-activos": "active_rides",
  "conductores-online": "online_drivers",
  "clientes-activos": "active_customers",
};

const statusMeta = {
  requested: { label: "Solicitada", class: "border-sky-200 bg-sky-50 text-sky-700" },
  pending_driver: { label: "Buscando conductor", class: "border-amber-200 bg-amber-50 text-amber-800" },
  driver_assigned: { label: "Asignada", class: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  driver_en_route: { label: "En camino", class: "border-blue-200 bg-blue-50 text-blue-800" },
  driver_arrived: { label: "Conductor llegó", class: "border-violet-200 bg-violet-50 text-violet-800" },
  in_progress: { label: "En curso", class: "border-slate-300 bg-slate-100 text-slate-800" },
};

const state = reactive({
  loading: true,
  error: "",
  rides: [],
  drivers: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

let socket = null;
let refreshTimer = null;

function normalizeTab(value) {
  return tabs.some((tab) => tab.key === value) ? value : "active_rides";
}

function resolveRouteTab() {
  const viewParam = Array.isArray(route.params.monitoringView)
    ? route.params.monitoringView[0]
    : route.params.monitoringView;
  return tabAliases[String(viewParam || "").toLowerCase()] || normalizeTab(String(route.query.vista || "active_rides"));
}

async function fetchMonitoring({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const [driversData, ridesData] = await Promise.all([
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
      apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" }),
    ]);
    state.drivers = driversData?.drivers || [];
    state.rides = ridesData?.rides || [];
    state.lastUpdatedAt = driversData?.server?.now || new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudo cargar el monitoreo.";
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchMonitoring({ quiet: true }));
  socket.on("admin:driver-location-updated", () => fetchMonitoring({ quiet: true }));
  socket.on("admin:driver-status-updated", () => fetchMonitoring({ quiet: true }));
}

function setTab(tabKey) {
  const normalized = normalizeTab(tabKey);
  const tab = tabs.find((item) => item.key === normalized) || tabs[0];
  filters.tab = normalized;
  router.replace(`/admin/operacion/monitoreo/${tab.slug}`);
}

function personName(person) {
  const contact = person?.contact || person;
  if (contact?.fullName) return contact.fullName;
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return name || contact?.email || shortId(person?.userId || person?.id);
}

function driverVehicle(driver) {
  const vehicle = driver?.vehicle || {};
  const parts = [vehicle.color, vehicle.make, vehicle.model].filter(Boolean);
  return parts.length ? parts.join(" ") : "-";
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

function matchesSearch(values) {
  const query = filters.search.trim().toLowerCase();
  if (!query) return true;
  return values.filter(Boolean).join(" ").toLowerCase().includes(query);
}

const activeTab = computed(() => tabs.find((tab) => tab.key === filters.tab) || tabs[0]);
const activeRides = computed(() => state.rides.filter((ride) => !terminalStatuses.includes(ride.status)));
const onlineDrivers = computed(() =>
  state.drivers.filter((driver) => ["online", "busy"].includes(String(driver.status || "").toLowerCase())),
);
const activeCustomers = computed(() => {
  const customers = new Map();
  for (const ride of activeRides.value) {
    const passenger = ride.passenger || ride.client;
    const key = ride.clientId || passenger?.id || passenger?.email;
    if (!key) continue;
    const current = customers.get(key) || {
      key,
      customer: passenger,
      rides: [],
      lastRequestedAt: ride.requestedAt,
    };
    current.rides.push(ride);
    if (new Date(ride.requestedAt).getTime() > new Date(current.lastRequestedAt).getTime()) {
      current.lastRequestedAt = ride.requestedAt;
    }
    customers.set(key, current);
  }
  return Array.from(customers.values());
});

const visibleRides = computed(() =>
  activeRides.value.filter((ride) =>
    matchesSearch([
      ride.id,
      ride.status,
      ride.pickupAddress,
      ride.dropoffAddress,
      ride.passenger?.email,
      ride.passenger?.firstName,
      ride.passenger?.lastName,
      ride.passenger?.fullName,
      ride.client?.email,
      ride.client?.firstName,
      ride.client?.lastName,
      ride.driver?.email,
      ride.driver?.firstName,
      ride.driver?.lastName,
      ride.driver?.fullName,
    ]),
  ),
);

const visibleDrivers = computed(() =>
  onlineDrivers.value.filter((driver) =>
    matchesSearch([
      driver.userId,
      driver.status,
      driver.contact?.email,
      driver.contact?.firstName,
      driver.contact?.lastName,
      driver.contact?.phoneNumber,
      driver.vehicle?.plate,
      driver.vehicle?.model,
      driver.vehicle?.make,
      driver.vehicle?.color,
    ]),
  ),
);

const visibleCustomers = computed(() =>
  activeCustomers.value.filter((item) =>
    matchesSearch([
      item.key,
      item.customer?.email,
      item.customer?.firstName,
      item.customer?.lastName,
      ...item.rides.map((ride) => ride.pickupAddress),
    ]),
  ),
);

const summary = computed(() => [
  { label: "Viajes activos", value: activeRides.value.length, icon: MapPin },
  { label: "Conductores online", value: onlineDrivers.value.length, icon: Car },
  { label: "Clientes activos", value: activeCustomers.value.length, icon: Users },
]);

watch(
  () => route.params.monitoringView,
  () => {
    filters.tab = resolveRouteTab();
  },
);

onMounted(() => {
  fetchMonitoring();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchMonitoring({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (socket) socket.disconnect();
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Operación</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Monitoreo</h1>
        <p class="mt-1 text-sm text-slate-500">Seguimiento de viajes, conductores y clientes activos.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchMonitoring"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 md:grid-cols-3">
      <div v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
          </div>
          <span class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="item.icon" class="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition',
              activeTab.key === tab.key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ]"
            type="button"
            @click="setTab(tab.key)"
          >
            <component :is="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
        </div>

        <label class="relative min-w-64 flex-1 md:max-w-sm">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model="filters.search"
            class="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
            placeholder="Buscar"
            type="search"
          />
        </label>
      </div>

      <div class="p-4">
        <div v-if="activeTab.key === 'active_rides'" class="grid gap-3">
          <div
            v-for="ride in visibleRides"
            :key="ride.id"
            class="grid gap-3 rounded-md border border-slate-200 p-3 lg:grid-cols-[1fr_180px_180px]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-sm font-semibold text-slate-950">#{{ shortId(ride.id) }}</span>
                <button
                  class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                  title="Copiar ID de solicitud"
                  aria-label="Copiar ID de solicitud"
                  @click="copyText(ride.id)"
                >
                  <Copy class="h-3.5 w-3.5" />
                </button>
                <span :class="['rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(ride.status)]">
                  {{ statusLabel(ride.status) }}
                </span>
              </div>
              <div class="mt-2 grid gap-1 text-sm text-slate-600">
                <span class="truncate">Origen: {{ ride.pickupAddress || "-" }}</span>
                <span class="truncate">Destino: {{ ride.dropoffAddress || "-" }}</span>
              </div>
            </div>
            <div class="text-sm">
              <div class="text-slate-500">Cliente</div>
              <div class="font-medium text-slate-950">{{ personName(ride.passenger || ride.client) }}</div>
            </div>
            <div class="text-sm">
              <div class="text-slate-500">Conductor</div>
              <div class="font-medium text-slate-950">{{ personName(ride.driver) }}</div>
            </div>
          </div>
          <div v-if="!state.loading && visibleRides.length === 0" class="py-10 text-center text-sm text-slate-500">
            No hay viajes activos.
          </div>
        </div>

        <div v-else-if="activeTab.key === 'online_drivers'" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div v-for="driver in visibleDrivers" :key="driver.userId" class="rounded-md border border-slate-200 p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate font-medium text-slate-950">{{ personName(driver) }}</div>
                <div class="mt-1 truncate text-sm text-slate-500">{{ driver.contact?.email || "Sin correo" }}</div>
              </div>
              <span class="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                {{ driver.status || "online" }}
              </span>
            </div>
            <div class="mt-3 grid gap-1 text-sm text-slate-600">
              <span>Teléfono: {{ driver.contact?.phoneNumber || "-" }}</span>
              <span>Placa: {{ driver.vehicle?.plate || "-" }}</span>
              <span>Vehículo: {{ driverVehicle(driver) }}</span>
              <span>Servicios: {{ driver.serviceTypes?.length ? driver.serviceTypes.join(", ") : "-" }}</span>
              <span>GPS: {{ formatAge(driver.updatedAt) }}</span>
              <span v-if="driver.currentLocation" class="font-mono text-xs">
                {{ Number(driver.currentLocation.lat).toFixed(5) }},
                {{ Number(driver.currentLocation.lng).toFixed(5) }}
              </span>
            </div>
          </div>
          <div v-if="!state.loading && visibleDrivers.length === 0" class="py-10 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
            No hay conductores online.
          </div>
        </div>

        <div v-else class="grid gap-3">
          <div v-for="item in visibleCustomers" :key="item.key" class="rounded-md border border-slate-200 p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <UserRound class="h-4 w-4 text-slate-500" />
                  <span class="truncate font-medium text-slate-950">{{ personName(item.customer) }}</span>
                </div>
                <div class="mt-1 truncate text-sm text-slate-500">{{ item.customer?.email || "Sin correo" }}</div>
              </div>
              <span class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                <Clock3 class="h-3.5 w-3.5" />
                {{ formatAge(item.lastRequestedAt) }}
              </span>
            </div>
            <div class="mt-3 text-sm text-slate-600">
              {{ item.rides.length }} viaje{{ item.rides.length === 1 ? "" : "s" }} activo{{ item.rides.length === 1 ? "" : "s" }}
            </div>
          </div>
          <div v-if="!state.loading && visibleCustomers.length === 0" class="py-10 text-center text-sm text-slate-500">
            No hay clientes activos.
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
