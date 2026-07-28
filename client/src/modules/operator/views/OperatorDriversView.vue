<script setup>
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Car, MapPin, RefreshCw, Search, UserCheck, WifiOff } from "lucide-vue-next";
import { driverPresenceClass, driverPresenceKey, driverPresenceLabel, offlineReasonLabel } from "../../../lib/driverPresence.js";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const operationalSettings = useOperationalSettings();

const tabs = [
  { key: "available", slug: "available", label: "Disponibles" },
  { key: "busy", slug: "busy", label: "Ocupados" },
  { key: "disconnected", slug: "disconnected", label: "Desconectados" },
  { key: "search", slug: "search-driver", label: "Buscar Conductor" },
];

const tabAliases = {
  ...Object.fromEntries(tabs.map((tab) => [tab.slug, tab.key])),
  disponibles: "available",
  ocupados: "busy",
  desconectados: "disconnected",
  "buscar-conductor": "search",
};

const state = reactive({
  loading: true,
  error: "",
  drivers: [],
  rides: [],
  selectedDriverId: "",
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

let socket = null;
let refreshTimer = null;
const mapEl = ref(null);
let driversMap = null;
let driverMarkers = [];

function resolveRouteTab() {
  const param = Array.isArray(route.params.driverView) ? route.params.driverView[0] : route.params.driverView;
  return tabAliases[String(param || "").toLowerCase()] || "available";
}

function setTab(tabKey) {
  const tab = tabs.find((item) => item.key === tabKey) || tabs[0];
  filters.tab = tab.key;
  router.replace(`/operator/conductores/${tab.slug}`);
}

async function fetchDrivers({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const [driversData, ridesData] = await Promise.all([
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
      apiRequest("/api/rides?limit=500&includeDriver=true", { method: "GET" }),
    ]);
    state.drivers = driversData?.drivers || [];
    state.rides = ridesData?.rides || [];
    state.lastUpdatedAt = driversData?.server?.now || new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar conductores.";
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("admin:driver-status-updated", (payload) => upsertDriver(payload?.driver));
  socket.on("admin:driver-location-updated", (payload) => upsertDriver(payload?.driver));
  socket.on("operations:ride-updated", () => fetchDrivers({ quiet: true }));
}

function upsertDriver(nextDriver) {
  if (!nextDriver?.userId) return;
  const index = state.drivers.findIndex((driver) => driver.userId === nextDriver.userId);
  if (index < 0) {
    state.drivers.push(nextDriver);
  } else {
    state.drivers[index] = {
      ...state.drivers[index],
      ...nextDriver,
      contact: { ...state.drivers[index].contact, ...nextDriver.contact },
      vehicle: { ...state.drivers[index].vehicle, ...nextDriver.vehicle },
    };
  }
  state.lastUpdatedAt = new Date().toISOString();
  updateMap();
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

function driverName(driver) {
  const name = [driver?.contact?.firstName, driver?.contact?.lastName].filter(Boolean).join(" ").trim();
  return name || driver?.contact?.email || shortId(driver?.userId);
}

function vehicleLabel(driver) {
  const vehicle = driver?.vehicle || {};
  return [vehicle.plate, vehicle.make, vehicle.model].filter(Boolean).join(" · ") || "-";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesSearch(driver) {
  const query = normalize(filters.search.trim());
  if (!query) return true;
  return normalize([
    driver.userId,
    driverName(driver),
    driver.contact?.email,
    driver.contact?.phoneNumber,
    vehicleLabel(driver),
    driver.serviceTypes?.join(" "),
    driverPresenceLabel(driver),
  ].filter(Boolean).join(" ")).includes(query);
}

function isSimulated(driver) {
  return /^driver\d+@test\.com$/i.test(driver?.contact?.email || "");
}

const activeTab = computed(() => tabs.find((tab) => tab.key === filters.tab) || tabs[0]);
const activeRidesByDriverId = computed(() => {
  const map = new Map();
  for (const ride of state.rides) {
    if (!ride.driverId) continue;
    if (["completed", "canceled_by_client", "canceled_by_driver", "canceled_by_system", "no_show"].includes(ride.status)) continue;
    if (!map.has(ride.driverId)) map.set(ride.driverId, []);
    map.get(ride.driverId).push(ride);
  }
  return map;
});

const availableDrivers = computed(() => state.drivers.filter((driver) => driverPresenceKey(driver) === "available"));
const busyDrivers = computed(() => state.drivers.filter((driver) => ["busy", "busy_unreachable"].includes(driverPresenceKey(driver))));
const disconnectedDrivers = computed(() =>
  state.drivers.filter((driver) => ["driver_offline", "connection_lost"].includes(driverPresenceKey(driver)))
);

const tabDrivers = computed(() => {
  if (activeTab.value.key === "busy") return busyDrivers.value;
  if (activeTab.value.key === "disconnected") return disconnectedDrivers.value;
  if (activeTab.value.key === "search") return state.drivers;
  return availableDrivers.value;
});

const visibleDrivers = computed(() =>
  tabDrivers.value
    .filter(matchesSearch)
    .sort((a, b) => driverName(a).localeCompare(driverName(b)))
);

const selectedDriver = computed(() =>
  visibleDrivers.value.find((driver) => driver.userId === state.selectedDriverId) ||
  visibleDrivers.value.find((driver) => driver.currentLocation) ||
  visibleDrivers.value[0] ||
  null
);

const summary = computed(() => [
  { label: "Disponibles", value: availableDrivers.value.length, icon: UserCheck },
  { label: "Ocupados", value: busyDrivers.value.length, icon: Car },
  { label: "Desconectados", value: disconnectedDrivers.value.length, icon: WifiOff },
  { label: "Total", value: state.drivers.length, icon: Car },
]);

watch(() => route.params.driverView, () => {
  filters.tab = resolveRouteTab();
  state.selectedDriverId = "";
  updateMap();
});

watch(visibleDrivers, () => {
  if (state.selectedDriverId && !visibleDrivers.value.some((driver) => driver.userId === state.selectedDriverId)) {
    state.selectedDriverId = "";
  }
  updateMap();
});

function isValidLocation(location) {
  return Number.isFinite(location?.lat) && Number.isFinite(location?.lng);
}

function initMap() {
  if (!mapEl.value || driversMap) return;
  const center = operationalSettings.mapCenter.value;
  driversMap = L.map(mapEl.value, { zoomControl: false }).setView([center.lat, center.lng], operationalSettings.mapDefaultZoom.value);
  L.control.zoom({ position: "topright" }).addTo(driversMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(driversMap);
}

function markerIcon(driver, selected = false) {
  const key = driverPresenceKey(driver);
  const bg =
    key === "available"
      ? "bg-emerald-600"
      : ["busy", "busy_unreachable"].includes(key)
      ? "bg-blue-600"
      : "bg-slate-500";
  const ring = selected ? "ring-4 ring-slate-950/20 scale-110" : "";
  return L.divIcon({
    className: "",
    html: `<div class="grid h-8 w-8 place-items-center rounded-full border-2 border-white ${bg} ${ring} text-xs font-bold text-white shadow">C</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function clearMarkers() {
  driverMarkers.forEach((marker) => marker.remove());
  driverMarkers = [];
}

function updateMap() {
  nextTick(() => {
    initMap();
    if (!driversMap) return;
    clearMarkers();

    const bounds = [];
    visibleDrivers.value.forEach((driver) => {
      if (!isValidLocation(driver.currentLocation)) return;
      const selected = driver.userId === selectedDriver.value?.userId;
      const marker = L.marker([driver.currentLocation.lat, driver.currentLocation.lng], {
        icon: markerIcon(driver, selected),
      })
        .addTo(driversMap)
        .bindTooltip(`${driverName(driver)}<br>${driverPresenceLabel(driver)} · ${vehicleLabel(driver)}`)
        .on("click", () => selectDriver(driver));
      driverMarkers.push(marker);
      bounds.push([driver.currentLocation.lat, driver.currentLocation.lng]);
    });

    const selectedLocation = selectedDriver.value?.currentLocation;
    if (isValidLocation(selectedLocation)) {
      driversMap.setView([selectedLocation.lat, selectedLocation.lng], 15);
    } else if (bounds.length > 1) {
      driversMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    } else if (bounds.length === 1) {
      driversMap.setView(bounds[0], 14);
    } else {
      const center = operationalSettings.mapCenter.value;
      driversMap.setView([center.lat, center.lng], operationalSettings.mapDefaultZoom.value);
    }

    driversMap.invalidateSize();
    window.setTimeout(() => driversMap?.invalidateSize(), 120);
  });
}

function selectDriver(driver) {
  state.selectedDriverId = driver?.userId || "";
  updateMap();
}

onMounted(async () => {
  filters.tab = resolveRouteTab();
  await operationalSettings.fetchOperationalSettings();
  await fetchDrivers();
  await nextTick();
  updateMap();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchDrivers({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  socket?.disconnect();
  socket = null;
  if (refreshTimer) window.clearInterval(refreshTimer);
  clearMarkers();
  if (driversMap) {
    driversMap.remove();
    driversMap = null;
  }
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Conductores</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">{{ activeTab.label }}</h1>
        <p class="mt-1 text-sm text-slate-500">Estado operativo, ubicación y servicio actual con datos reales.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchDrivers"
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
        <div class="flex flex-wrap gap-2">
          <div class="flex flex-wrap gap-2">
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
      </div>

      <div class="grid min-h-[640px] overflow-hidden xl:grid-cols-[380px_minmax(520px,1fr)]">
        <aside class="border-b border-slate-200 bg-white p-3 xl:border-b-0 xl:border-r">
          <label class="relative mb-3 block">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-10 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar conductor..."
            />
          </label>

          <div class="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <h2 class="text-sm font-semibold text-slate-950">{{ activeTab.label }}</h2>
              <p class="text-xs text-slate-500">{{ visibleDrivers.length }} conductores visibles</p>
            </div>
            <span class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {{ state.lastUpdatedAt ? formatDate(state.lastUpdatedAt) : "Sin actualizar" }}
            </span>
          </div>

          <div class="grid max-h-[470px] gap-2 overflow-y-auto pr-1 xl:max-h-[520px]">
            <button
              v-for="driver in visibleDrivers"
              :key="driver.userId"
              :class="[
                'rounded-md border p-3 text-left transition hover:border-slate-300 hover:bg-slate-50',
                selectedDriver?.userId === driver.userId ? 'border-slate-950 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white',
              ]"
              type="button"
              @click="selectDriver(driver)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate font-medium text-slate-950">{{ driverName(driver) }}</div>
                  <div class="truncate text-xs text-slate-500">{{ driver.contact?.phoneNumber || driver.contact?.email || "-" }}</div>
                  <div class="font-mono text-xs text-slate-400">{{ shortId(driver.userId) }}</div>
                </div>
                <span :class="['shrink-0 rounded-md border px-2 py-1 text-xs font-medium', driverPresenceClass(driver)]">
                  {{ driverPresenceLabel(driver) }}
                </span>
              </div>

              <div class="mt-3 grid gap-2 text-xs text-slate-600">
                <div class="flex items-start gap-2">
                  <Car class="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span class="min-w-0 truncate">{{ vehicleLabel(driver) }}</span>
                </div>
                <div class="flex items-start gap-2">
                  <MapPin class="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span v-if="driver.currentLocation">
                    {{ Number(driver.currentLocation.lat).toFixed(5) }},
                    {{ Number(driver.currentLocation.lng).toFixed(5) }}
                  </span>
                  <span v-else class="text-slate-400">Sin ubicación GPS</span>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span>{{ activeRidesByDriverId.get(driver.userId)?.length || 0 }} servicios activos</span>
                  <span class="text-slate-400">{{ formatDate(driver.lastSeenAt) }}</span>
                </div>
                <div v-if="driver.offlineReason || isSimulated(driver)" class="text-slate-400">
                  {{ driver.offlineReason ? offlineReasonLabel(driver.offlineReason) : "Simulado" }}
                </div>
              </div>
            </button>

            <div v-if="state.loading" class="rounded-md border border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-500">
              Cargando conductores...
            </div>
            <div v-else-if="visibleDrivers.length === 0" class="rounded-md border border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-500">
              No hay conductores para esta vista.
            </div>
          </div>

        </aside>

        <main class="relative min-h-[640px] bg-slate-100">
          <div ref="mapEl" class="h-full min-h-[640px] w-full"></div>

          <div class="absolute left-4 top-4 z-[500] max-w-[320px] rounded-md border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">Mapa de conductores</div>
            <div v-if="selectedDriver" class="mt-2">
              <div class="font-semibold text-slate-950">{{ driverName(selectedDriver) }}</div>
              <div class="mt-1 text-xs text-slate-500">{{ driverPresenceLabel(selectedDriver) }} · {{ vehicleLabel(selectedDriver) }}</div>
            </div>
            <p v-else class="mt-2 text-xs text-slate-500">Selecciona un conductor de la lista para centrarlo en el mapa.</p>
          </div>

          <div class="absolute bottom-4 left-4 z-[500] rounded-md border border-slate-200 bg-white/95 p-3 text-xs text-slate-600 shadow-sm backdrop-blur">
            <div class="mb-2 font-semibold text-slate-950">Leyenda</div>
            <div class="grid gap-2">
              <div class="flex items-center gap-2"><span class="h-3 w-3 rounded-full bg-emerald-600"></span>Disponible</div>
              <div class="flex items-center gap-2"><span class="h-3 w-3 rounded-full bg-blue-600"></span>Ocupado</div>
              <div class="flex items-center gap-2"><span class="h-3 w-3 rounded-full bg-slate-500"></span>Desconectado</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  </section>
</template>
