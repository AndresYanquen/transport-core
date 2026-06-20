<script setup>
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Car, Crosshair, MapPinned, Radio, RefreshCw, Search, Wifi, WifiOff } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";
import { driverPresenceClass, driverPresenceKey, driverPresenceLabel, isDriverStale, offlineReasonLabel } from "../../../lib/driverPresence.js";

const mapEl = ref(null);
const auth = useAuthStore();

const state = reactive({
  loading: true,
  socketConnected: false,
  error: "",
  search: "",
  statusFilter: "active",
  drivers: [],
  selectedDriverId: null,
  lastUpdatedAt: null,
});

let map = null;
let driverLayer = null;
let socket = null;
let refreshTimer = null;
const markerByDriverId = new Map();

const locatedDrivers = computed(() => state.drivers.filter((driver) => hasLocation(driver)));
const onlineDrivers = computed(() => state.drivers.filter((driver) => driverPresenceKey(driver) === "available"));
const busyDrivers = computed(() => state.drivers.filter((driver) => ["busy", "busy_unreachable"].includes(driverPresenceKey(driver))));
const staleDrivers = computed(() => state.drivers.filter((driver) => isDriverStale(driver)));

const filteredDrivers = computed(() => {
  const query = state.search.trim().toLowerCase();
  return state.drivers.filter((driver) => {
    const presenceKey = driverPresenceKey(driver);
    if (state.statusFilter === "active" && !["available", "busy", "busy_unreachable"].includes(presenceKey)) return false;
    if (state.statusFilter !== "all" && state.statusFilter !== "active" && presenceKey !== state.statusFilter) return false;
    if (!query) return true;

    const haystack = [
      driver.contact?.firstName,
      driver.contact?.lastName,
      driver.contact?.email,
      driver.contact?.phoneNumber,
      driver.vehicle?.plate,
      driver.vehicle?.model,
      driver.userId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
});

const selectedDriver = computed(() => state.drivers.find((driver) => driver.userId === state.selectedDriverId) || null);

function hasLocation(driver) {
  return Number.isFinite(Number(driver?.currentLocation?.lat)) && Number.isFinite(Number(driver?.currentLocation?.lng));
}

function driverName(driver) {
  const fullName = [driver?.contact?.firstName, driver?.contact?.lastName].filter(Boolean).join(" ").trim();
  return fullName || driver?.contact?.email || shortId(driver?.userId);
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatVehicle(driver) {
  const parts = [driver?.vehicle?.color, driver?.vehicle?.make, driver?.vehicle?.model].filter(Boolean);
  return parts.length ? parts.join(" ") : "Vehiculo sin detalle";
}

function initMap() {
  if (!mapEl.value || map) return;

  map = L.map(mapEl.value, {
    zoomControl: true,
  }).setView([5.535, -73.367], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(map);

  driverLayer = L.layerGroup().addTo(map);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function markerIcon(driver) {
  const presence = driverPresenceKey(driver);
  const tone = presence === "available" ? "online" : presence === "busy" ? "busy" : presence === "unavailable" ? "unavailable" : presence === "busy_unreachable" || presence === "connection_lost" ? "connection-lost" : "offline";
  const heading = Number(driver.headingDegrees || 0);

  return L.divIcon({
    className: "",
    html: `
      <span class="driver-map-marker driver-map-marker--${tone}">
        <span class="driver-map-marker__arrow" style="transform: rotate(${heading}deg)"></span>
      </span>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function markerPopup(driver) {
  return `
    <strong>${escapeHtml(driverName(driver))}</strong><br>
    ${escapeHtml(driverPresenceLabel(driver))}<br>
    ${escapeHtml(driver.vehicle?.plate || "Sin placa")} · ${escapeHtml(formatVehicle(driver))}<br>
    Última conexión: ${escapeHtml(formatTime(driver.lastSeenAt))}
  `;
}

function renderDrivers() {
  if (!driverLayer) return;

  const visibleIds = new Set();
  for (const driver of filteredDrivers.value) {
    if (!hasLocation(driver)) continue;

    visibleIds.add(driver.userId);
    const latLng = [driver.currentLocation.lat, driver.currentLocation.lng];
    const existingMarker = markerByDriverId.get(driver.userId);

    if (existingMarker) {
      existingMarker.setLatLng(latLng);
      existingMarker.setIcon(markerIcon(driver));
      existingMarker.setPopupContent(markerPopup(driver));
      continue;
    }

    const marker = L.marker(latLng, {
      icon: markerIcon(driver),
      keyboard: true,
      title: driverName(driver),
    })
      .addTo(driverLayer)
      .bindPopup(markerPopup(driver));

    marker.on("click", () => {
      state.selectedDriverId = driver.userId;
    });
    markerByDriverId.set(driver.userId, marker);
  }

  for (const [driverId, marker] of markerByDriverId.entries()) {
    if (visibleIds.has(driverId)) continue;
    driverLayer.removeLayer(marker);
    markerByDriverId.delete(driverId);
  }
}

function fitAllDrivers() {
  if (!map) return;
  const points = filteredDrivers.value
    .filter((driver) => hasLocation(driver))
    .map((driver) => [driver.currentLocation.lat, driver.currentLocation.lng]);

  if (!points.length) return;
  map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 15 });
}

function focusDriver(driver) {
  if (!map || !hasLocation(driver)) return;
  state.selectedDriverId = driver.userId;
  map.setView([driver.currentLocation.lat, driver.currentLocation.lng], Math.max(map.getZoom(), 16), { animate: true });
  markerByDriverId.get(driver.userId)?.openPopup();
}

function upsertDriver(nextDriver) {
  if (!nextDriver?.userId) return;
  const index = state.drivers.findIndex((driver) => driver.userId === nextDriver.userId);
  if (index >= 0) {
    state.drivers[index] = {
      ...state.drivers[index],
      ...nextDriver,
      contact: {
        ...state.drivers[index].contact,
        ...nextDriver.contact,
      },
      vehicle: {
        ...state.drivers[index].vehicle,
        ...nextDriver.vehicle,
      },
    };
  } else {
    state.drivers.unshift(nextDriver);
  }
  state.lastUpdatedAt = new Date().toISOString();
  renderDrivers();
}

async function fetchSnapshot({ fit = false } = {}) {
  state.error = "";
  try {
    const result = await apiRequest("/api/admin/drivers-map", { method: "GET" });
    state.drivers = result?.drivers || [];
    state.lastUpdatedAt = result?.server?.now || new Date().toISOString();
    renderDrivers();
    if (fit) fitAllDrivers();
  } catch (err) {
    state.error = err?.message || "No se pudo cargar el mapa de conductores.";
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;

  socket = createRealtimeSocket(auth.state.token);
  socket.on("connect", () => {
    state.socketConnected = true;
    state.error = "";
  });
  socket.on("disconnect", () => {
    state.socketConnected = false;
  });
  socket.on("connect_error", (err) => {
    state.socketConnected = false;
    state.error = err?.message || "No se pudo conectar al tiempo real.";
  });
  socket.on("admin:driver-location-updated", (payload) => {
    upsertDriver(payload?.driver);
  });
  socket.on("admin:driver-status-updated", (payload) => {
    upsertDriver(payload?.driver);
  });
}

function setStatusFilter(value) {
  state.statusFilter = value;
  renderDrivers();
}

function setSearch(value) {
  state.search = value;
  renderDrivers();
}

onMounted(async () => {
  await nextTick();
  initMap();
  await fetchSnapshot({ fit: true });
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchSnapshot(), 30000);
  setTimeout(() => map?.invalidateSize(), 100);
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  if (map) {
    map.remove();
    map = null;
  }
  markerByDriverId.clear();
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Dashboard</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Mapa de Conductores</h1>
        <p class="mt-1 text-sm text-slate-500">Ubicacion y estado operativo en tiempo real.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium"
          :class="state.socketConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'"
        >
          <Wifi v-if="state.socketConnected" class="h-4 w-4" />
          <WifiOff v-else class="h-4 w-4" />
          {{ state.socketConnected ? "En vivo" : "Reconectando" }}
        </span>
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          type="button"
          @click="fetchSnapshot({ fit: true })"
        >
          <RefreshCw class="h-4 w-4" />
          Actualizar
        </button>
      </div>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div class="flex items-center gap-2 text-sm font-medium text-slate-800">
            <MapPinned class="h-4 w-4" />
            Conductores con GPS
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              :disabled="locatedDrivers.length === 0"
              type="button"
              @click="fitAllDrivers"
            >
              <Crosshair class="h-4 w-4" />
              Encuadrar
            </button>
          </div>
        </div>
        <div class="relative">
          <div ref="mapEl" class="h-[calc(100vh-220px)] min-h-[560px] w-full"></div>
          <div
            v-if="state.loading"
            class="absolute inset-0 z-[1000] grid place-items-center bg-white/75 text-sm font-medium text-slate-600"
          >
            Cargando conductores...
          </div>
        </div>
      </div>

      <aside class="grid content-start gap-4">
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-md border border-slate-200 bg-white p-3">
            <div class="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Online</div>
            <div class="mt-1 text-2xl font-semibold text-slate-950">{{ onlineDrivers.length }}</div>
          </div>
          <div class="rounded-md border border-slate-200 bg-white p-3">
            <div class="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Ocupados</div>
            <div class="mt-1 text-2xl font-semibold text-slate-950">{{ busyDrivers.length }}</div>
          </div>
          <div class="rounded-md border border-slate-200 bg-white p-3">
            <div class="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Con GPS</div>
            <div class="mt-1 text-2xl font-semibold text-slate-950">{{ locatedDrivers.length }}</div>
          </div>
          <div class="rounded-md border border-slate-200 bg-white p-3">
            <div class="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Sin actualizar</div>
            <div class="mt-1 text-2xl font-semibold text-slate-950">{{ staleDrivers.length }}</div>
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-white p-4">
          <div class="flex items-center gap-2 rounded-md border border-slate-200 px-3">
            <Search class="h-4 w-4 text-slate-400" />
            <input
              class="h-9 min-w-0 flex-1 text-sm outline-none"
              :value="state.search"
              placeholder="Buscar conductor, placa o correo"
              @input="setSearch($event.target.value)"
            />
          </div>

          <div class="mt-3 grid grid-cols-3 gap-2">
            <button
              v-for="filter in [
                ['active', 'Activos'],
                ['available', 'Disponibles'],
                ['busy', 'Ocupados'],
                ['all', 'Todos'],
                ['unavailable', 'No disp.'],
                ['driver_offline', 'Offline'],
                ['connection_lost', 'Sin conexión'],
              ]"
              :key="filter[0]"
              class="h-8 rounded-md border px-2 text-xs font-medium"
              :class="state.statusFilter === filter[0] ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'"
              type="button"
              @click="setStatusFilter(filter[0])"
            >
              {{ filter[1] }}
            </button>
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-white">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 class="text-base font-semibold text-slate-950">Conductores</h2>
            <span class="text-sm text-slate-500">{{ filteredDrivers.length }}</span>
          </div>

          <div class="grid max-h-[470px] overflow-auto">
            <button
              v-for="driver in filteredDrivers"
              :key="driver.userId"
              class="grid gap-2 border-b border-slate-100 p-3 text-left hover:bg-slate-50"
              :class="state.selectedDriverId === driver.userId ? 'bg-slate-50' : ''"
              type="button"
              @click="focusDriver(driver)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-slate-950">{{ driverName(driver) }}</div>
                  <div class="mt-0.5 truncate text-xs text-slate-500">{{ driver.vehicle?.plate || "Sin placa" }} · {{ formatVehicle(driver) }}</div>
                </div>
                <span class="shrink-0 rounded border px-2 py-0.5 text-xs font-medium" :class="driverPresenceClass(driver)">
                  {{ driverPresenceLabel(driver) }}
                </span>
              </div>
              <div class="flex items-center justify-between text-xs text-slate-500">
                <span class="inline-flex items-center gap-1">
                  <Radio class="h-3.5 w-3.5" />
                  {{ formatTime(driver.lastSeenAt) }}
                </span>
                <span v-if="driver.currentRideId" class="inline-flex items-center gap-1 text-amber-700">
                  <Car class="h-3.5 w-3.5" />
                  {{ shortId(driver.currentRideId) }}
                </span>
              </div>
            </button>

            <div v-if="!state.loading && filteredDrivers.length === 0" class="py-8 text-center text-sm text-slate-500">
              No hay conductores para este filtro.
            </div>
          </div>
        </div>

        <div v-if="selectedDriver" class="rounded-md border border-slate-200 bg-white p-4">
          <h2 class="text-base font-semibold text-slate-950">{{ driverName(selectedDriver) }}</h2>
          <div class="mt-3 grid gap-2 text-sm text-slate-600">
            <div class="flex justify-between gap-3">
              <span>Estado</span>
              <span class="font-medium text-slate-950">{{ driverPresenceLabel(selectedDriver) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>Velocidad</span>
              <span class="font-medium text-slate-950">{{ selectedDriver.speedKmh ?? 0 }} km/h</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>Última conexión</span>
              <span class="font-medium text-slate-950">{{ formatTime(selectedDriver.lastSeenAt) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>Motivo offline</span>
              <span class="text-right font-medium text-slate-950">{{ offlineReasonLabel(selectedDriver.offlineReason) }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>Intención</span>
              <span class="font-medium text-slate-950">{{ selectedDriver.availabilityIntent || "-" }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span>Servicios</span>
              <span class="font-medium text-slate-950">{{ selectedDriver.serviceTypes?.join(", ") || "-" }}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style>
.driver-map-marker {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 2px solid #ffffff;
  border-radius: 999px;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.32);
}

.driver-map-marker--online {
  background: #059669;
}

.driver-map-marker--busy {
  background: #d97706;
}

.driver-map-marker--unavailable {
  background: #64748b;
}

.driver-map-marker--offline {
  background: #94a3b8;
}

.driver-map-marker--connection-lost {
  background: #dc2626;
}

.driver-map-marker__arrow {
  display: block;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 14px solid #ffffff;
  transform-origin: 50% 65%;
}
</style>
