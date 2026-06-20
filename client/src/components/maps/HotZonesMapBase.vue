<script setup>
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "./map-markers.css";

import L from "leaflet";
import "leaflet.markercluster";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  AlertTriangle, CalendarRange, Check, Clock3, Eye, EyeOff, Flame, Layers3,
  MapPin, MapPinned, PanelRightOpen, RefreshCw, Settings2, Users, Wifi,
  WifiOff, X,
} from "lucide-vue-next";
import { useRouter } from "vue-router";
import { apiRequest } from "../../services/api.js";
import { createRealtimeSocket } from "../../services/realtime.js";
import { useAuthStore } from "../../stores/auth.js";
import {
  createDriverMarkerIcon,
  createRequestMarkerIcon,
  escapeMapHtml,
  shortMapId,
} from "./mapPrimitives.js";
import { driverPresenceLabel } from "../../lib/driverPresence.js";

const mapEl = ref(null);
const requestsPanelEl = ref(null);
const router = useRouter();
const auth = useAuthStore();
const state = reactive({
  loading: true,
  error: "",
  zones: [],
  coverage: null,
  requests: [],
  drivers: [],
  serviceTypes: [],
  totals: { requests: 0, activeRequests: 0, availableDrivers: 0, deficit: 0 },
  selectedZoneId: null,
  selectedRequestId: null,
  selectedDriverId: null,
  socketConnected: false,
  lastUpdatedAt: null,
});
const filters = reactive({ period: "24", status: "all", serviceType: "all" });
const layers = reactive({ coverage: true, zones: true, demand: true, requests: true });
const indicatorsVisible = ref(true);
const requestsPanelVisible = ref(true);

let map = null;
let coverageLayer = null;
let zoneLayer = null;
let requestLayer = null;
let driverLayer = null;
let socket = null;
let refreshTimer = null;
let refreshDebounce = null;
const polygonByZoneId = new Map();
const markerByRequestId = new Map();
const markerByDriverId = new Map();

const levelMeta = {
  low: { label: "Baja", color: "#16a34a", fill: "#86efac" },
  medium: { label: "Media", color: "#ca8a04", fill: "#fde047" },
  high: { label: "Alta", color: "#ea580c", fill: "#fb923c" },
  critical: { label: "Critica", color: "#dc2626", fill: "#ef4444" },
};
const statusLabels = {
  requested: "Solicitada",
  pending_driver: "Buscando conductor",
  driver_assigned: "Asignada",
  driver_en_route: "En camino",
  driver_arrived: "Conductor llego",
  in_progress: "En curso",
};

const rankedZones = computed(() => [...state.zones].sort((a, b) =>
  b.metrics.activeRequests - a.metrics.activeRequests ||
  b.metrics.requests - a.metrics.requests ||
  b.metrics.deficit - a.metrics.deficit,
));
const selectedZone = computed(() => state.zones.find((zone) => zone.id === state.selectedZoneId) || null);
const selectedRequest = computed(() => state.requests.find((request) => request.id === state.selectedRequestId) || null);
const selectedDriver = computed(() => state.drivers.find((driver) => driver.userId === state.selectedDriverId) || null);
const visibleRequests = computed(() => {
  if (!state.selectedZoneId) return state.requests;
  return state.requests.filter((request) => request.zoneId === state.selectedZoneId);
});
const selectedZoneDrivers = computed(() => {
  if (!state.selectedZoneId) return [];
  return state.drivers.filter((driver) => driver.zoneId === state.selectedZoneId);
});
const averageWait = computed(() => {
  const values = state.zones.map((zone) => zone.metrics.averageWaitSeconds).filter(Boolean);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
});

function initMap() {
  if (!mapEl.value || map) return;
  map = L.map(mapEl.value, { zoomControl: true }).setView([5.535, -73.367], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap", maxZoom: 19,
  }).addTo(map);
  map.createPane("hotCoveragePane");
  map.getPane("hotCoveragePane").style.zIndex = "320";
  map.getPane("hotCoveragePane").style.pointerEvents = "none";
  map.createPane("hotZonePane");
  map.getPane("hotZonePane").style.zIndex = "360";
  map.createPane("hotRequestPane");
  map.getPane("hotRequestPane").style.zIndex = "650";
  map.createPane("hotDriverPane");
  map.getPane("hotDriverPane").style.zIndex = "700";
  coverageLayer = L.layerGroup().addTo(map);
  zoneLayer = L.layerGroup().addTo(map);
  requestLayer = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 44,
    spiderfyOnMaxZoom: true,
  }).addTo(map);
  driverLayer = L.layerGroup().addTo(map);
}

function renderMap({ fit = false } = {}) {
  if (!map) return;
  coverageLayer.clearLayers();
  zoneLayer.clearLayers();
  requestLayer.clearLayers();
  driverLayer.clearLayers();
  polygonByZoneId.clear();
  markerByRequestId.clear();
  markerByDriverId.clear();
  const bounds = [];

  if (layers.coverage && state.coverage) {
    L.geoJSON(state.coverage, {
      pane: "hotCoveragePane",
      interactive: false,
      style: { color: "#2563eb", fillColor: "#93c5fd", fillOpacity: 0.08, weight: 3, dashArray: "8 6" },
    }).addTo(coverageLayer);
  }

  if (layers.zones || layers.demand) {
    for (const zone of state.zones) {
      const latLngs = zone.coordinates.map(([lng, lat]) => [lat, lng]);
      if (latLngs.length < 4) continue;
      const tone = levelMeta[zone.metrics.level] || levelMeta.low;
      const polygon = L.polygon(latLngs, {
        pane: "hotZonePane",
        color: layers.demand ? tone.color : (zone.color || "#64748b"),
        fillColor: layers.demand ? tone.fill : (zone.color || "#cbd5e1"),
        fillOpacity: layers.demand ? (state.selectedZoneId === zone.id ? 0.58 : 0.34) : 0.1,
        weight: state.selectedZoneId === zone.id ? 4 : 2,
      }).addTo(zoneLayer);
      polygon.bindTooltip(`<strong>${escapeHtml(zone.name)}</strong><br>${zone.metrics.activeRequests} activas · ${zone.metrics.availableDrivers} disponibles`, { sticky: true });
      polygon.on("click", () => selectZone(zone));
      polygonByZoneId.set(zone.id, polygon);
      bounds.push(...latLngs);
    }
  }

  if (layers.requests) {
    for (const request of state.requests) {
      if (!request.pickupLocation) continue;
      const marker = L.marker([request.pickupLocation.lat, request.pickupLocation.lng], {
        pane: "hotRequestPane",
        bubblingMouseEvents: false,
        icon: requestIcon(request),
        title: request.pickupAddress || "Solicitud",
      });
      marker.bindTooltip(`#${shortId(request.id)} · ${escapeHtml(request.serviceName)}`);
      marker.on("click", (event) => {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        selectRequest(request);
      });
      requestLayer.addLayer(marker);
      markerByRequestId.set(request.id, marker);
    }
  }

  for (const driver of state.drivers) {
    if (!driver.location) continue;
    const isSelectedZone = !state.selectedZoneId || driver.zoneId === state.selectedZoneId;
    const marker = L.marker([driver.location.lat, driver.location.lng], {
      pane: "hotDriverPane",
      bubblingMouseEvents: false,
      icon: driverIcon(driver, isSelectedZone),
      title: driver.name,
      opacity: isSelectedZone ? 1 : 0.28,
      zIndexOffset: isSelectedZone ? 300 : 0,
    });
    marker.bindTooltip(
      `<strong>${escapeHtml(driver.name)}</strong><br>${escapeHtml(driver.vehicle?.plate || "Sin placa")} · Disponible`,
    );
    marker.on("click", (event) => {
      if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      requestsPanelVisible.value = true;
      state.selectedDriverId = driver.userId;
      state.selectedRequestId = null;
      if (driver.zoneId) {
        state.selectedZoneId = driver.zoneId;
        renderMap();
      }
    });
    marker.addTo(driverLayer);
    markerByDriverId.set(driver.userId, marker);
  }

  if (fit && bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
}

function driverIcon(driver, highlighted) {
  return createDriverMarkerIcon(driver, { muted: !highlighted });
}

function requestIcon(request) {
  return createRequestMarkerIcon(request);
}

function escapeHtml(value) {
  return escapeMapHtml(value);
}

function selectZone(zone) {
  requestsPanelVisible.value = true;
  state.selectedZoneId = state.selectedZoneId === zone.id ? null : zone.id;
  state.selectedRequestId = null;
  state.selectedDriverId = null;
  renderMap();
}

function focusZone(zone) {
  state.selectedZoneId = zone.id;
  state.selectedRequestId = null;
  state.selectedDriverId = null;
  renderMap();
  const polygon = polygonByZoneId.get(zone.id);
  if (polygon) map.fitBounds(polygon.getBounds(), { padding: [45, 45], maxZoom: 16 });
}

async function selectRequest(request) {
  requestsPanelVisible.value = true;
  state.selectedRequestId = request.id;
  state.selectedDriverId = null;
  if (request.zoneId) state.selectedZoneId = request.zoneId;
  await nextTick();
  requestsPanelEl.value?.scrollTo({ top: 0, behavior: "smooth" });
}

function focusRequest(request) {
  selectRequest(request);
  if (!request.pickupLocation) return;
  map.setView([request.pickupLocation.lat, request.pickupLocation.lng], Math.max(map.getZoom(), 17), { animate: true });
  markerByRequestId.get(request.id)?.openTooltip();
}

function toggleLayer(key) {
  layers[key] = !layers[key];
  renderMap();
}

async function toggleIndicators() {
  indicatorsVisible.value = !indicatorsVisible.value;
  await nextTick();
  map?.invalidateSize();
}

function dateRange() {
  const to = new Date();
  return {
    from: new Date(to.getTime() - Number(filters.period) * 60 * 60 * 1000).toISOString(),
    to: to.toISOString(),
  };
}

async function fetchSnapshot({ fit = false, quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";
  const params = new URLSearchParams({ ...dateRange(), status: filters.status, serviceType: filters.serviceType });
  try {
    const result = await apiRequest(`/api/admin/hot-zones?${params}`, { method: "GET" });
    state.zones = result?.zones || [];
    state.coverage = result?.coverage || null;
    state.requests = result?.requests || [];
    state.drivers = (result?.drivers || []).map((driver) => ({
      ...driver,
      status: driver.status || "online",
      availabilityIntent: driver.availabilityIntent || "online",
    }));
    state.serviceTypes = result?.serviceTypes || [];
    state.totals = result?.totals || state.totals;
    state.lastUpdatedAt = result?.server?.now || new Date().toISOString();
    if (!state.zones.some((zone) => zone.id === state.selectedZoneId)) state.selectedZoneId = null;
    if (!state.requests.some((request) => request.id === state.selectedRequestId)) state.selectedRequestId = null;
    renderMap({ fit });
  } catch (error) {
    state.error = error?.message || "No se pudo cargar el analisis de zonas.";
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("connect", () => { state.socketConnected = true; });
  socket.on("disconnect", () => { state.socketConnected = false; });
  socket.on("connect_error", () => { state.socketConnected = false; });
  socket.on("admin:driver-location-updated", scheduleRefresh);
  socket.on("admin:driver-status-updated", scheduleRefresh);
  socket.on("operations:ride-updated", scheduleRefresh);
}

function scheduleRefresh() {
  if (refreshDebounce) window.clearTimeout(refreshDebounce);
  refreshDebounce = window.setTimeout(() => fetchSnapshot({ quiet: true }), 500);
}

function formatWait(seconds) {
  return seconds ? `${Math.max(1, Math.round(seconds / 60))} min` : "0 min";
}

function formatAge(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  return `Hace ${Math.floor(minutes / 60)} h`;
}

function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";
}

function formatLastSeen(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function shortId(value) {
  return shortMapId(value);
}

watch(() => [filters.period, filters.status, filters.serviceType], () => fetchSnapshot());

onMounted(async () => {
  await nextTick();
  initMap();
  await fetchSnapshot({ fit: true });
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchSnapshot({ quiet: true }), 30000);
  window.setTimeout(() => map?.invalidateSize(), 100);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (refreshDebounce) window.clearTimeout(refreshDebounce);
  socket?.disconnect();
  map?.remove();
  polygonByZoneId.clear();
  markerByRequestId.clear();
  markerByDriverId.clear();
});
</script>

<template>
  <section class="flex h-[calc(100vh-56px)] min-h-[620px] flex-col overflow-hidden bg-slate-100">
    <div class="relative z-[700] shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Zonas</p>
          <h1 class="mt-0.5 text-xl font-semibold text-slate-950">Zonas calientes</h1>
          <p class="mt-0.5 text-sm text-slate-500">Demanda y solicitudes activas en tiempo real.</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium" :class="state.socketConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'">
            <Wifi v-if="state.socketConnected" class="h-4 w-4" /><WifiOff v-else class="h-4 w-4" />
            {{ state.socketConnected ? "En vivo" : "Actualizacion periodica" }}
          </span>
          <button class="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" title="Actualizar" type="button" @click="fetchSnapshot({ fit: true })">
            <RefreshCw class="h-4 w-4" />
          </button>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <CalendarRange class="h-4 w-4 text-slate-500" />
        <select v-model="filters.serviceType" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="all">Todos los servicios</option>
          <option v-for="service in state.serviceTypes" :key="service.code" :value="service.code">{{ service.name }}</option>
        </select>
        <select v-model="filters.period" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="1">Ultima hora</option><option value="6">Ultimas 6 horas</option>
          <option value="24">Ultimas 24 horas</option><option value="168">Ultimos 7 dias</option>
        </select>
        <select v-model="filters.status" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm">
          <option value="all">Todos los estados</option><option value="requested">Solicitadas</option>
          <option value="pending_driver">Buscando conductor</option><option value="driver_assigned">Asignadas</option>
          <option value="in_progress">En curso</option><option value="completed">Completadas</option>
        </select>
        <span class="ml-auto text-xs text-slate-500">Actualizado {{ formatTime(state.lastUpdatedAt) }}</span>
      </div>
    </div>

    <div class="relative min-h-0 flex-1 overflow-hidden bg-slate-200">
      <div ref="mapEl" class="absolute inset-0 z-0 h-full w-full"></div>

      <div v-if="!state.loading && !state.error && state.zones.length === 0" class="absolute inset-0 z-[1100] grid place-items-center bg-slate-100/90 p-6 text-center backdrop-blur-sm">
      <div class="max-w-md">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-md bg-amber-50 text-amber-700"><MapPinned class="h-6 w-6" /></div>
        <h2 class="mt-4 text-xl font-semibold text-slate-950">Configura primero las zonas de cobertura</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">Necesitamos al menos una zona activa para calcular demanda, disponibilidad y tiempos de espera.</p>
        <button
          class="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800"
          type="button"
          @click="router.push('/admin/zonas/mapa-de-cobertura')"
        >
          <Settings2 class="h-4 w-4" />Configurar zonas
        </button>
      </div>
    </div>

      <button
      class="absolute right-4 top-4 z-[1200] inline-flex h-10 items-center gap-2 rounded-lg border border-white/60 bg-slate-950/90 px-3 text-sm font-medium text-white shadow-xl backdrop-blur hover:bg-slate-800"
      type="button"
      :title="indicatorsVisible ? 'Ocultar indicadores' : 'Mostrar indicadores'"
      @click="toggleIndicators"
    >
      <EyeOff v-if="indicatorsVisible" class="h-4 w-4" />
      <Eye v-else class="h-4 w-4" />
      {{ indicatorsVisible ? "Ocultar paneles" : "Mostrar paneles" }}
    </button>

    <template v-if="indicatorsVisible">
      <div class="pointer-events-none absolute inset-0 z-[500] flex flex-col p-4">
        <div class="pointer-events-auto ml-12 grid w-fit max-w-[calc(100%-228px)] grid-cols-2 gap-1.5 lg:grid-cols-4">
          <div class="min-w-28 rounded-lg border border-white/70 bg-white/90 px-2.5 py-2 shadow-lg backdrop-blur"><div class="flex items-center gap-1.5 text-[10px] font-medium uppercase text-slate-500"><Flame class="h-3.5 w-3.5" />Solicitudes</div><div class="mt-0.5 text-lg font-semibold leading-tight">{{ state.totals.requests }}</div></div>
          <div class="min-w-28 rounded-lg border border-white/70 bg-white/90 px-2.5 py-2 shadow-lg backdrop-blur"><div class="flex items-center gap-1.5 text-[10px] font-medium uppercase text-slate-500"><AlertTriangle class="h-3.5 w-3.5" />Activas</div><div class="mt-0.5 text-lg font-semibold leading-tight">{{ state.requests.length }}</div></div>
          <div class="min-w-28 rounded-lg border border-white/70 bg-white/90 px-2.5 py-2 shadow-lg backdrop-blur"><div class="flex items-center gap-1.5 text-[10px] font-medium uppercase text-slate-500"><Users class="h-3.5 w-3.5" />Conductores</div><div class="mt-0.5 text-lg font-semibold leading-tight">{{ state.totals.availableDrivers }}</div></div>
          <div class="min-w-28 rounded-lg border border-white/70 bg-white/90 px-2.5 py-2 shadow-lg backdrop-blur"><div class="flex items-center gap-1.5 text-[10px] font-medium uppercase text-slate-500"><Clock3 class="h-3.5 w-3.5" />Espera aprox.</div><div class="mt-0.5 text-lg font-semibold leading-tight">{{ formatWait(averageWait) }}</div></div>
        </div>

        <div class="pointer-events-auto mt-auto w-48 rounded-xl border border-white/70 bg-white/90 p-2 shadow-xl backdrop-blur">
          <div class="mb-1 flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase text-slate-500"><Layers3 class="h-4 w-4" />Capas</div>
          <button v-for="item in [['coverage','Cobertura'],['zones','Zonas operativas'],['demand','Demanda'],['requests','Solicitudes']]" :key="item[0]" class="flex h-8 w-full items-center gap-2 rounded px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer(item[0])">
            <span class="grid h-4 w-4 place-items-center rounded border" :class="layers[item[0]] ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'"><Check v-if="layers[item[0]]" class="h-3 w-3" /></span>{{ item[1] }}
          </button>
        </div>
      </div>

      <button
        v-if="!requestsPanelVisible"
        class="absolute right-0 top-1/2 z-[700] grid h-14 w-10 -translate-y-1/2 place-items-center rounded-l-lg border border-r-0 border-white/70 bg-white/95 text-slate-700 shadow-xl backdrop-blur hover:bg-white"
        type="button"
        aria-label="Mostrar panel de solicitudes"
        title="Mostrar solicitudes"
        @click="requestsPanelVisible = true"
      >
        <PanelRightOpen class="h-5 w-5" />
      </button>

      <aside v-if="requestsPanelVisible" ref="requestsPanelEl" class="absolute bottom-4 right-4 top-16 z-[600] grid w-[min(390px,calc(100%-2rem))] min-w-0 content-start gap-3 overflow-y-auto rounded-xl border border-white/70 bg-white/90 p-3 pt-12 shadow-2xl backdrop-blur">
          <button
            class="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            type="button"
            aria-label="Cerrar panel de solicitudes"
            title="Cerrar panel"
            @click="requestsPanelVisible = false"
          >
            <X class="h-4 w-4" />
          </button>
          <div v-if="selectedRequest" class="rounded-md border border-violet-200 bg-violet-50 p-4">
            <div class="flex items-start justify-between gap-3"><div><p class="text-xs font-medium uppercase text-violet-700">Solicitud seleccionada</p><h2 class="mt-1 font-semibold text-slate-950">#{{ shortId(selectedRequest.id) }}</h2></div><MapPin class="h-5 w-5 text-violet-700" /></div>
            <div class="mt-3 text-sm text-slate-700"><strong>{{ selectedRequest.pickupAddress }}</strong><p class="mt-1">{{ selectedRequest.clientName }} · {{ selectedRequest.serviceName }}</p><p class="mt-1 text-xs">{{ statusLabels[selectedRequest.status] }} · {{ formatAge(selectedRequest.requestedAt) }}</p></div>
          </div>

          <div v-else-if="selectedDriver" class="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-medium uppercase text-emerald-700">Conductor seleccionado</p>
                <h2 class="mt-1 font-semibold text-slate-950">{{ selectedDriver.name }}</h2>
              </div>
              <span class="h-3 w-3 rounded-full bg-emerald-500"></span>
            </div>
            <p class="mt-3 text-sm text-slate-700">
              <strong>{{ selectedDriver.vehicle?.plate || "Sin placa" }}</strong>
              · {{ [selectedDriver.vehicle?.color, selectedDriver.vehicle?.make, selectedDriver.vehicle?.model].filter(Boolean).join(" ") || "Vehículo sin detalle" }}
            </p>
            <p class="mt-1 text-xs text-slate-500">{{ selectedDriver.zoneName }} · {{ driverPresenceLabel(selectedDriver) }}</p>
            <p class="mt-1 text-xs text-slate-500">Última conexión: {{ formatLastSeen(selectedDriver.lastSeenAt) }}</p>
          </div>

          <div v-else-if="selectedZone" class="rounded-md border border-slate-200 bg-white p-4">
            <div class="flex items-start justify-between gap-3">
              <div><p class="text-xs font-medium uppercase text-slate-500">Zona seleccionada</p><h2 class="mt-1 text-lg font-semibold">{{ selectedZone.name }}</h2></div>
              <span class="rounded px-2 py-1 text-xs font-semibold text-white" :style="{ backgroundColor: levelMeta[selectedZone.metrics.level].color }">{{ levelMeta[selectedZone.metrics.level].label }}</span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><span class="block text-xs text-slate-500">Activas</span><strong>{{ selectedZone.metrics.activeRequests }}</strong></div>
              <div><span class="block text-xs text-slate-500">Disponibles</span><strong>{{ selectedZone.metrics.availableDrivers }}</strong></div>
              <div><span class="block text-xs text-slate-500">Espera</span><strong>{{ formatWait(selectedZone.metrics.averageWaitSeconds) }}</strong></div>
              <div><span class="block text-xs text-slate-500">Deficit</span><strong :class="selectedZone.metrics.deficit > 0 ? 'text-rose-700' : 'text-emerald-700'">{{ selectedZone.metrics.deficit }}</strong></div>
            </div>
            <div class="mt-4 border-t border-slate-200 pt-3">
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold uppercase text-slate-500">Conductores disponibles</span>
                <span class="text-sm font-semibold text-emerald-700">{{ selectedZoneDrivers.length }}</span>
              </div>
              <div v-if="selectedZoneDrivers.length" class="mt-2 grid gap-1.5">
                <button
                  v-for="driver in selectedZoneDrivers"
                  :key="driver.userId"
                  class="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-2.5 py-2 text-left hover:bg-emerald-100"
                  type="button"
                  @click="markerByDriverId.get(driver.userId)?.openTooltip()"
                >
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-slate-900">{{ driver.name }}</span>
                    <span class="block truncate text-xs text-slate-500">{{ driver.vehicle?.plate || "Sin placa" }} · {{ [driver.vehicle?.color, driver.vehicle?.make, driver.vehicle?.model].filter(Boolean).join(" ") }}</span>
                  </span>
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"></span>
                </button>
              </div>
              <p v-else class="mt-2 text-sm text-slate-500">No hay conductores disponibles en esta zona.</p>
            </div>
          </div>

          <div class="rounded-md border border-slate-200 bg-white">
            <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 class="font-semibold">Solicitudes {{ selectedZone ? `en ${selectedZone.name}` : "activas" }}</h2><span class="text-sm text-slate-500">{{ visibleRequests.length }}</span></div>
            <div class="max-h-[390px] overflow-auto">
              <button v-for="request in visibleRequests" :key="request.id" class="block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50" :class="state.selectedRequestId === request.id ? 'bg-violet-50' : ''" type="button" @click="focusRequest(request)">
                <div class="flex items-start justify-between gap-2"><strong class="text-sm">#{{ shortId(request.id) }}</strong><span class="text-xs text-slate-500">{{ formatAge(request.requestedAt) }}</span></div>
                <div class="mt-1 truncate text-sm text-slate-700">{{ request.pickupAddress }}</div>
                <div class="mt-2 flex items-center justify-between gap-2 text-xs"><span class="rounded px-2 py-0.5" :style="{ color: request.serviceColor, backgroundColor: `${request.serviceColor}18` }">{{ request.serviceName }}</span><span class="text-slate-500">{{ statusLabels[request.status] }}</span></div>
              </button>
              <div v-if="visibleRequests.length === 0" class="p-6 text-center text-sm text-slate-500">No hay solicitudes activas en esta zona.</div>
            </div>
          </div>

          <div class="rounded-md border border-slate-200 bg-white">
            <div class="border-b border-slate-200 px-4 py-3 font-semibold">Ranking de demanda</div>
            <button v-for="(zone, index) in rankedZones" :key="zone.id" class="grid w-full grid-cols-[24px_1fr_auto] items-center gap-2 border-b border-slate-100 p-3 text-left hover:bg-slate-50" type="button" @click="focusZone(zone)">
              <span class="text-sm font-semibold text-slate-400">{{ index + 1 }}</span><span class="truncate text-sm font-medium">{{ zone.name }}</span><span class="rounded px-2 py-0.5 text-xs font-semibold text-white" :style="{ backgroundColor: levelMeta[zone.metrics.level].color }">{{ zone.metrics.activeRequests }}</span>
            </button>
          </div>
      </aside>
    </template>

    <div v-if="state.error" class="absolute bottom-4 left-1/2 z-[1200] -translate-x-1/2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-xl">{{ state.error }}</div>
    <div v-if="state.loading" class="absolute inset-0 z-[1000] grid place-items-center bg-white/60 text-sm font-medium text-slate-700 backdrop-blur-sm">Calculando zonas...</div>
    </div>
  </section>
</template>

<style>
.hot-request-marker {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 3px solid #fff;
  border-radius: 999px;
  background: var(--request-color);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.35);
}
.hot-request-marker > span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #fff;
}
.hot-driver-marker {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #059669;
  box-shadow: 0 5px 14px rgba(15, 23, 42, 0.32);
}
.hot-driver-marker > span {
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 12px solid #fff;
  transform-origin: 50% 65%;
}
.hot-driver-marker--highlighted {
  outline: 3px solid rgba(16, 185, 129, 0.35);
}
.hot-driver-marker--muted {
  filter: grayscale(0.8);
}
.marker-cluster-small,
.marker-cluster-medium,
.marker-cluster-large {
  background: rgba(124, 58, 237, 0.22);
}
.marker-cluster-small div,
.marker-cluster-medium div,
.marker-cluster-large div {
  background: #7c3aed;
  color: #fff;
  font-weight: 700;
}
</style>
