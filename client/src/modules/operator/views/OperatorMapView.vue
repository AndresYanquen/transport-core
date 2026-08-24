<script setup>
import "leaflet/dist/leaflet.css";
import "../../../components/maps/map-markers.css";
import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Car, Check, Clock3, Copy, Layers3, LocateFixed, RefreshCw, Search, UserCheck, Wifi, WifiOff, X } from "lucide-vue-next";
import {
  createDriverMarkerIcon,
  createRequestMarkerIcon,
  addBaseTileLayer,
  escapeMapHtml,
  shortMapId,
} from "../../../components/maps/mapPrimitives.js";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";
import { driverPresenceLabel, isDriverStale } from "../../../lib/driverPresence.js";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const auth = useAuthStore();
const operationalSettings = useOperationalSettings();
const mapEl = ref(null);
const state = reactive({
  loading: true,
  error: "",
  requests: [],
  drivers: [],
  zones: [],
  selectedRequestId: null,
  selectedDriverId: null,
  selectedRequestEvents: [],
  selectedRequestEventsLoading: false,
  selectedRequestEventsError: "",
  socketConnected: false,
  lastUpdatedAt: null,
});
const filters = reactive({ status: "all", search: "" });
const layers = reactive({ zones: true, requests: true, drivers: true });
const activeList = ref("requests");

let map;
let zoneLayer;
let requestLayer;
let driverLayer;
let socket;
let refreshTimer;
let refreshDebounce;
const requestMarkers = new Map();
const driverMarkers = new Map();

const activeRequests = computed(() => state.requests.filter((request) =>
  !["completed", "canceled_by_client", "canceled_by_driver", "canceled_by_system", "no_show"].includes(request.status),
));
const visibleRequests = computed(() => {
  const query = filters.search.trim().toLowerCase();
  return activeRequests.value.filter((request) => {
    const matchesStatus = filters.status === "all" || request.status === filters.status;
    const haystack = [request.id, request.clientName, request.pickupAddress, request.serviceName]
      .filter(Boolean).join(" ").toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
});
// The hot-zones endpoint already returns only online drivers.
const availableDrivers = computed(() => state.drivers);
const selectedRequest = computed(() =>
  state.requests.find((request) => request.id === state.selectedRequestId) || null,
);
const selectedDriver = computed(() =>
  state.drivers.find((driver) => driver.userId === state.selectedDriverId) || null,
);

function formatLastSeen(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatEventTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isAssignable(driver) {
  return driver?.status === "online" && (!driver.lastSeenAt || !isDriverStale(driver));
}

function initMap() {
  if (map || !mapEl.value) return;
  const center = operationalSettings.mapCenter.value;
  map = L.map(mapEl.value).setView([center.lat, center.lng], operationalSettings.mapDefaultZoom.value);
  addBaseTileLayer(map);
  map.createPane("operatorZonePane");
  map.getPane("operatorZonePane").style.zIndex = "350";
  map.createPane("operatorRequestPane");
  map.getPane("operatorRequestPane").style.zIndex = "650";
  map.createPane("operatorDriverPane");
  map.getPane("operatorDriverPane").style.zIndex = "750";
  zoneLayer = L.layerGroup().addTo(map);
  requestLayer = L.layerGroup().addTo(map);
  driverLayer = L.layerGroup().addTo(map);
  map.on("click", clearSelection);
}

function renderMap({ fit = false } = {}) {
  if (!map) return;
  zoneLayer.clearLayers();
  requestLayer.clearLayers();
  driverLayer.clearLayers();
  requestMarkers.clear();
  driverMarkers.clear();
  const bounds = [];

  if (layers.zones) {
    for (const zone of state.zones) {
      const coordinates = Array.isArray(zone.coordinates) ? zone.coordinates : [];
      const latLngs = coordinates.map(([lng, lat]) => [lat, lng]);
      if (latLngs.length < 3) continue;

      const polygon = L.polygon(latLngs, {
        pane: "operatorZonePane",
        color: zone.color || "#0f766e",
        fillColor: zone.color || "#5eead4",
        fillOpacity: 0.12,
        weight: 2,
      })
        .bindTooltip(`<strong>${escapeMapHtml(zone.name)}</strong>`, {
          direction: "center",
          permanent: false,
        })
        .addTo(zoneLayer);

      bounds.push(...latLngs);
      polygon.on("mouseover", () => polygon.setStyle({ fillOpacity: 0.22, weight: 3 }));
      polygon.on("mouseout", () => polygon.setStyle({ fillOpacity: 0.12, weight: 2 }));
    }
  }

  if (layers.requests) {
    for (const request of visibleRequests.value) {
      if (!request.pickupLocation) continue;
      const position = [request.pickupLocation.lat, request.pickupLocation.lng];
      const marker = L.marker(position, {
        pane: "operatorRequestPane",
        icon: createRequestMarkerIcon(request),
      })
        .bindTooltip(`#${shortMapId(request.id)} · ${escapeMapHtml(request.serviceName)}`)
        .on("click", () => { focusRequest(request); })
        .addTo(requestLayer);
      requestMarkers.set(request.id, marker);
      bounds.push(position);
    }
  }

  if (layers.drivers) {
    for (const driver of availableDrivers.value) {
      if (!driver.location) continue;
      const position = [driver.location.lat, driver.location.lng];
      const marker = L.marker(position, {
        pane: "operatorDriverPane",
        icon: createDriverMarkerIcon(driver),
        zIndexOffset: 1000,
      })
        .bindTooltip(`<strong>${escapeMapHtml(driver.name)}</strong><br>${escapeMapHtml(driver.vehicle?.plate || "Sin placa")}<br>Última conexión: ${escapeMapHtml(formatLastSeen(driver.lastSeenAt))}`)
        .on("click", () => {
          state.selectedDriverId = driver.userId;
          state.selectedRequestId = null;
        })
        .addTo(driverLayer);
      driverMarkers.set(driver.userId, marker);
      bounds.push(position);
    }
  }

  if (fit && bounds.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
}

async function fetchSnapshot({ fit = false, quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      status: "all",
      serviceType: "all",
    });
    const result = await apiRequest(`/api/admin/hot-zones?${params}`, { method: "GET" });
    state.requests = result?.requests || [];
    state.drivers = (result?.drivers || []).map((driver) => ({
      ...driver,
      status: driver.status || "online",
      availabilityIntent: driver.availabilityIntent || "online",
    }));
    state.zones = result?.zones || [];
    state.lastUpdatedAt = result?.server?.now || new Date().toISOString();
    renderMap({ fit });
  } catch (error) {
    state.error = error?.message || "No se pudo cargar la operación.";
  } finally {
    state.loading = false;
  }
}

async function loadRequestHistory(requestId) {
  state.selectedRequestEvents = [];
  state.selectedRequestEventsError = "";
  state.selectedRequestEventsLoading = true;
  try {
    const result = await apiRequest(`/api/rides/${requestId}?includeEvents=true&eventsLimit=50`, {
      method: "GET",
    });
    state.selectedRequestEvents = (result?.events || []).slice(-6).reverse();
  } catch (error) {
    state.selectedRequestEventsError = error?.message || "No se pudo cargar el historial.";
  } finally {
    state.selectedRequestEventsLoading = false;
  }
}

function focusRequest(request) {
  state.selectedRequestId = request.id;
  state.selectedDriverId = null;
  loadRequestHistory(request.id);
  if (!request.pickupLocation) return;
  map?.setView([request.pickupLocation.lat, request.pickupLocation.lng], 17, { animate: true });
  requestMarkers.get(request.id)?.openTooltip();
}

function clearSelection() {
  state.selectedRequestId = null;
  state.selectedDriverId = null;
  state.selectedRequestEvents = [];
  state.selectedRequestEventsError = "";
  state.selectedRequestEventsLoading = false;
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

function focusDriver(driver) {
  if (!isAssignable(driver)) return;
  state.selectedDriverId = driver.userId;
  state.selectedRequestId = null;
  state.selectedRequestEvents = [];
  state.selectedRequestEventsError = "";
  if (!driver.location) return;
  map?.setView([driver.location.lat, driver.location.lng], 17, { animate: true });
  driverMarkers.get(driver.userId)?.openTooltip();
}

function toggleLayer(layer) {
  layers[layer] = !layers[layer];
  if (layer === "requests" && !layers.requests && layers.drivers) {
    activeList.value = "drivers";
  }
  renderMap();
}

function scheduleRefresh() {
  window.clearTimeout(refreshDebounce);
  refreshDebounce = window.setTimeout(() => fetchSnapshot({ quiet: true }), 500);
}

function connectRealtime() {
  if (!auth.state.token) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("connect", () => { state.socketConnected = true; });
  socket.on("disconnect", () => { state.socketConnected = false; });
  socket.on("connect_error", () => { state.socketConnected = false; });
  socket.on("admin:driver-location-updated", scheduleRefresh);
  socket.on("admin:driver-status-updated", scheduleRefresh);
  socket.on("operations:ride-updated", scheduleRefresh);
}

function statusLabel(status) {
  return {
    requested: "Solicitada",
    pending_driver: "Buscando conductor",
    driver_assigned: "Asignada",
    driver_en_route: "En camino",
    driver_arrived: "Conductor llegó",
    in_progress: "En curso",
  }[status] || status;
}

function statusChipClass(status) {
  return {
    requested: "border-sky-200 bg-sky-50 text-sky-700",
    pending_driver: "border-amber-200 bg-amber-50 text-amber-800",
    driver_assigned: "border-emerald-200 bg-emerald-50 text-emerald-800",
    driver_en_route: "border-blue-200 bg-blue-50 text-blue-800",
    driver_arrived: "border-violet-200 bg-violet-50 text-violet-800",
    in_progress: "border-slate-300 bg-slate-100 text-slate-800",
  }[status] || "border-slate-200 bg-white text-slate-600";
}

function actorLabel(actorType) {
  return {
    client: "Cliente",
    driver: "Conductor",
    system: "Sistema",
  }[actorType] || "Operación";
}

watch(() => [filters.status, filters.search], () => renderMap());

onMounted(async () => {
  await operationalSettings.fetchOperationalSettings();
  await nextTick();
  initMap();
  await fetchSnapshot({ fit: true });
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchSnapshot({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  window.clearInterval(refreshTimer);
  window.clearTimeout(refreshDebounce);
  socket?.disconnect();
  map?.remove();
});
</script>

<template>
  <section class="grid h-[calc(100vh-56px)] min-h-[620px] grid-rows-[auto_1fr] overflow-hidden bg-slate-100">
    <header class="border-b border-slate-200 bg-white px-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">Consola operacional</p>
          <h1 class="text-xl font-semibold">Mapa de trabajo</h1>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm" :class="state.socketConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'">
            <Wifi v-if="state.socketConnected" class="h-4 w-4" /><WifiOff v-else class="h-4 w-4" />
            {{ state.socketConnected ? "En vivo" : "Actualización periódica" }}
          </span>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-slate-200" type="button" @click="fetchSnapshot({ fit: true })">
            <RefreshCw class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_200px_auto]">
        <label class="relative">
          <Search class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input v-model="filters.search" class="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm" placeholder="Buscar solicitud, cliente o dirección" />
        </label>
        <select v-model="filters.status" class="h-9 rounded-md border border-slate-200 px-3 text-sm">
          <option value="all">Todos los estados</option>
          <option value="pending_driver">Pendientes</option>
          <option value="driver_assigned">Asignadas</option>
          <option value="driver_en_route">En camino</option>
          <option value="in_progress">En curso</option>
        </select>
        <button class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm" type="button" @click="renderMap({ fit: true })">
          <LocateFixed class="h-4 w-4" />Centrar
        </button>
      </div>
    </header>

    <div class="grid min-h-0 lg:grid-cols-[360px_1fr]">
      <aside class="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div class="grid grid-cols-3 border-b border-slate-200">
          <div class="p-3"><Clock3 class="h-4 w-4 text-amber-600" /><strong class="mt-1 block text-xl">{{ visibleRequests.length }}</strong><span class="text-xs text-slate-500">Solicitudes</span></div>
          <div class="p-3"><UserCheck class="h-4 w-4 text-emerald-600" /><strong class="mt-1 block text-xl">{{ availableDrivers.length }}</strong><span class="text-xs text-slate-500">Disponibles</span></div>
          <div class="p-3"><Car class="h-4 w-4 text-blue-600" /><strong class="mt-1 block text-xl">{{ state.zones.length }}</strong><span class="text-xs text-slate-500">Zonas</span></div>
        </div>
        <div class="grid grid-cols-2 border-b border-slate-200 p-2">
          <button :class="['rounded-md px-3 py-2 text-sm font-medium', activeList === 'requests' ? 'bg-slate-950 text-white' : 'text-slate-600']" type="button" @click="activeList = 'requests'">
            Solicitudes ({{ visibleRequests.length }})
          </button>
          <button :class="['rounded-md px-3 py-2 text-sm font-medium', activeList === 'drivers' ? 'bg-slate-950 text-white' : 'text-slate-600']" type="button" @click="activeList = 'drivers'">
            Conductores ({{ availableDrivers.length }})
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <template v-if="activeList === 'requests'">
            <button
              v-for="request in visibleRequests"
              :key="request.id"
              class="block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50"
              :class="state.selectedRequestId === request.id ? 'bg-emerald-50' : ''"
              type="button"
              @click="focusRequest(request)"
            >
              <div class="flex items-start justify-between gap-2">
                <span class="flex min-w-0 items-center gap-1">
                  <strong class="pt-0.5">#{{ shortMapId(request.id) }}</strong>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID de solicitud"
                    aria-label="Copiar ID de solicitud"
                    @click.stop="copyText(request.id)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </span>
                <span :class="['inline-flex max-w-[160px] shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5', statusChipClass(request.status)]">
                  {{ statusLabel(request.status) }}
                </span>
              </div>
              <div class="mt-1 truncate text-sm">{{ request.pickupAddress }}</div>
              <div class="mt-1 text-xs text-slate-500">{{ request.clientName }} · {{ request.serviceName }}</div>
            </button>
            <p v-if="!visibleRequests.length && !state.loading" class="p-6 text-center text-sm text-slate-500">No hay solicitudes para los filtros seleccionados.</p>
          </template>

          <template v-else>
            <button
              v-for="driver in availableDrivers"
              :key="driver.userId"
              class="flex w-full items-center justify-between gap-3 border-b border-slate-100 p-3 text-left hover:bg-emerald-50"
              :disabled="!isAssignable(driver)"
              :class="!isAssignable(driver) ? 'cursor-not-allowed opacity-50' : ''"
              type="button"
              @click="focusDriver(driver)"
            >
              <span class="min-w-0">
                <strong class="block truncate text-sm">{{ driver.name }}</strong>
                <span class="block truncate text-xs text-slate-500">
                  {{ driver.vehicle?.plate || "Sin placa" }} · {{ driver.zoneName || "Sin zona" }}
                </span>
                <span class="block text-xs text-slate-400">Última conexión: {{ formatLastSeen(driver.lastSeenAt) }}</span>
              </span>
              <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            </button>
            <p v-if="!availableDrivers.length && !state.loading" class="p-6 text-center text-sm text-slate-500">No hay conductores disponibles.</p>
          </template>
        </div>
      </aside>

      <div class="relative min-h-0">
        <div ref="mapEl" class="absolute inset-0" />
        <div class="absolute right-4 top-4 z-[500] w-52 rounded-lg border border-white/70 bg-white/95 p-2 shadow-xl backdrop-blur">
          <div class="mb-1 flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase text-slate-500">
            <Layers3 class="h-4 w-4" />Capas
          </div>
          <button class="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer('zones')">
            <span :class="['grid h-4 w-4 place-items-center rounded border', layers.zones ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300']">
              <Check v-if="layers.zones" class="h-3 w-3" />
            </span>
            Zonas operativas
          </button>
          <button class="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer('requests')">
            <span :class="['grid h-4 w-4 place-items-center rounded border', layers.requests ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300']">
              <Check v-if="layers.requests" class="h-3 w-3" />
            </span>
            Solicitudes
          </button>
          <button class="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer('drivers')">
            <span :class="['grid h-4 w-4 place-items-center rounded border', layers.drivers ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300']">
              <Check v-if="layers.drivers" class="h-3 w-3" />
            </span>
            Conductores disponibles
          </button>
        </div>
        <div v-if="selectedRequest" class="absolute bottom-4 left-4 z-[500] max-h-[calc(100%-2rem)] w-[380px] max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-white/70 bg-white/95 shadow-xl" @click.stop>
          <div class="border-b border-slate-100 p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-medium uppercase text-emerald-700">Solicitud seleccionada</p>
                <div class="mt-1 flex items-center gap-1">
                  <h2 class="font-semibold">#{{ shortMapId(selectedRequest.id) }}</h2>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID de solicitud"
                    aria-label="Copiar ID de solicitud"
                    @click="copyText(selectedRequest.id)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span :class="['inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5', statusChipClass(selectedRequest.status)]">
                  {{ statusLabel(selectedRequest.status) }}
                </span>
                <button class="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900" type="button" aria-label="Cerrar historial" @click="clearSelection">
                  <X class="h-4 w-4" />
                </button>
              </div>
            </div>
            <p class="mt-2 text-sm">{{ selectedRequest.pickupAddress }}</p>
            <p class="mt-1 text-xs text-slate-500">{{ selectedRequest.clientName }} · {{ selectedRequest.serviceName }}</p>
          </div>

          <div class="max-h-64 overflow-y-auto p-4">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-xs font-semibold uppercase text-slate-500">Últimos estados</p>
              <button class="text-xs font-medium text-emerald-700 hover:text-emerald-900" type="button" @click="loadRequestHistory(selectedRequest.id)">
                Actualizar
              </button>
            </div>
            <p v-if="state.selectedRequestEventsLoading" class="text-sm text-slate-500">Cargando historial...</p>
            <p v-else-if="state.selectedRequestEventsError" class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ state.selectedRequestEventsError }}</p>
            <ol v-else-if="state.selectedRequestEvents.length" class="space-y-3">
              <li v-for="event in state.selectedRequestEvents" :key="event.id" class="grid grid-cols-[64px_1fr] gap-3">
                <time class="pt-0.5 text-xs text-slate-500">{{ formatEventTime(event.occurredAt || event.createdAt) }}</time>
                <div class="relative border-l border-slate-200 pl-3">
                  <span class="absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                  <span :class="['inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5', statusChipClass(event.status)]">
                    {{ statusLabel(event.status) }}
                  </span>
                  <p class="mt-1 text-xs text-slate-500">{{ actorLabel(event.actorType) }}</p>
                </div>
              </li>
            </ol>
            <p v-else class="text-sm text-slate-500">No hay historial registrado para este servicio.</p>
          </div>
        </div>
        <div v-else-if="selectedDriver" class="absolute bottom-4 left-4 z-[500] max-w-sm rounded-lg border border-white/70 bg-white/95 p-4 shadow-xl">
          <p class="text-xs font-medium uppercase text-emerald-700">Conductor seleccionado</p>
          <h2 class="mt-1 font-semibold">{{ selectedDriver.name }}</h2>
          <p class="mt-2 text-sm">{{ selectedDriver.vehicle?.plate || "Sin placa" }} · {{ selectedDriver.zoneName || "Sin zona" }}</p>
          <p class="mt-1 text-xs text-slate-500">{{ driverPresenceLabel(selectedDriver) }}</p>
          <p class="mt-1 text-xs text-slate-500">Última conexión: {{ formatLastSeen(selectedDriver.lastSeenAt) }}</p>
          <p v-if="selectedDriver.status === 'busy' && isDriverStale(selectedDriver)" class="mt-2 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
            Conexión perdida. El servicio permanece asignado.
          </p>
        </div>
        <div v-if="state.error" class="absolute bottom-4 right-4 z-[600] rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{{ state.error }}</div>
        <div v-if="state.loading" class="absolute inset-0 z-[700] grid place-items-center bg-white/60 text-sm font-medium backdrop-blur-sm">Cargando operación...</div>
      </div>
    </div>
  </section>
</template>
