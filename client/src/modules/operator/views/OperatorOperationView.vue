<script setup>
import "leaflet/dist/leaflet.css";
import "../../../components/maps/map-markers.css";
import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Car, Check, Clock3, Copy, Headphones, LocateFixed, MapPin, PhoneCall, Plus, Radio, RefreshCw, Search, Send, UserCheck, X } from "lucide-vue-next";
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
import OperatorRadioRequestsView from "./OperatorRadioRequestsView.vue";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const radioModal = ref(null);
const auth = useAuthStore();
const operationalSettings = useOperationalSettings();
const mapEl = ref(null);
const state = reactive({
  loading: true,
  creating: false,
  createPanelOpen: false,
  error: "",
  createError: "",
  radioLoading: false,
  radioActionId: "",
  radioError: "",
  radioSuccess: "",
  requests: [],
  radioRequests: [],
  drivers: [],
  zones: [],
  coverage: null,
  serviceTypes: [],
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
const PANEL_WIDTH_STORAGE_KEY = "operator.operation.panelWidth";
const DEFAULT_PANEL_WIDTH = 380;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 640;
const panelWidth = ref(DEFAULT_PANEL_WIDTH);
const isResizingPanel = ref(false);
const serviceForm = reactive({
  firstName: "",
  lastName: "",
  phoneNumber: "",
  serviceType: "standard",
  pickupAddress: "",
  hasDestination: false,
  dropoffAddress: "",
  requestDescription: "",
  estimatedFareAmount: "",
  autoAssign: true,
});

let map;
let zoneLayer;
let coverageLayer;
let requestLayer;
let driverLayer;
let socket;
let refreshTimer;
let refreshDebounce;
let resizeStartX = 0;
let resizeStartWidth = DEFAULT_PANEL_WIDTH;
const requestMarkers = new Map();
const driverMarkers = new Map();

function isLngLatPair(point) {
  return Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1]));
}

function toLatLngRing(ring) {
  if (!Array.isArray(ring)) return [];
  return ring
    .filter(isLngLatPair)
    .map(([lng, lat]) => [Number(lat), Number(lng)]);
}

function getZoneLatLngRings(zone) {
  const coordinates = zone?.coordinates;
  if (!Array.isArray(coordinates)) return [];

  if (coordinates.every(isLngLatPair)) {
    return [toLatLngRing(coordinates)].filter((ring) => ring.length >= 3);
  }

  if (Array.isArray(coordinates[0]) && coordinates[0].every?.(isLngLatPair)) {
    return coordinates.map(toLatLngRing).filter((ring) => ring.length >= 3);
  }

  if (Array.isArray(coordinates[0]?.[0]) && coordinates[0][0].every?.(isLngLatPair)) {
    return coordinates.flatMap((polygon) => polygon.map(toLatLngRing)).filter((ring) => ring.length >= 3);
  }

  return [];
}

function getZoneBounds(zone) {
  const layer = zone?.geometry ? L.geoJSON(zone.geometry) : null;
  if (layer) {
    const bounds = layer.getBounds();
    if (bounds.isValid()) return bounds;
  }

  const latLngs = getZoneLatLngRings(zone).flat();
  return latLngs.length ? L.latLngBounds(latLngs) : null;
}

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
const visibleDrivers = computed(() => {
  const query = filters.search.trim().toLowerCase();
  if (!query) return availableDrivers.value;

  return availableDrivers.value.filter((driver) => {
    const haystack = [
      driver.userId,
      driver.name,
      driver.zoneName,
      driver.vehicle?.plate,
      driver.vehicle?.make,
      driver.vehicle?.model,
      driver.vehicle?.color,
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(query);
  });
});
const pendingRequests = computed(() => activeRequests.value.filter((request) =>
  ["requested", "pending_driver"].includes(request.status),
));
const assignedRequests = computed(() => activeRequests.value.filter((request) =>
  ["driver_assigned", "driver_en_route", "driver_arrived"].includes(request.status),
));
const inProgressRequests = computed(() => activeRequests.value.filter((request) => request.status === "in_progress"));
const averageZoneWaitMinutes = computed(() => {
  const waits = state.zones
    .map((zone) => Number(zone.metrics?.averageWaitSeconds || 0))
    .filter((seconds) => seconds > 0);
  if (!waits.length) return "-";
  const avgSeconds = waits.reduce((sum, value) => sum + value, 0) / waits.length;
  return `${Math.max(1, Math.round(avgSeconds / 60))} min`;
});
const summaryCards = computed(() => [
  { label: "Conductores disponibles", value: availableDrivers.value.length, icon: Car, tone: "emerald" },
  { label: "Viajes activos", value: assignedRequests.value.length + inProgressRequests.value.length, icon: LocateFixed, tone: "blue" },
  { label: "Solicitudes pendientes", value: pendingRequests.value.length, icon: Clock3, tone: "amber" },
  { label: "Radio pendientes", value: state.radioRequests.length, icon: Headphones, tone: "slate" },
]);
const selectedRequest = computed(() =>
  state.requests.find((request) => request.id === state.selectedRequestId) || null,
);
const selectedDriver = computed(() =>
  state.drivers.find((driver) => driver.userId === state.selectedDriverId) || null,
);
const visibleRadioRequests = computed(() => {
  const query = filters.search.trim().toLowerCase();
  if (!query) return state.radioRequests;

  return state.radioRequests.filter((request) => [
    request.id,
    request.driverId,
    request.rideId,
    request.reason,
    request.priority,
    request.driver?.firstName,
    request.driver?.lastName,
    request.driver?.email,
  ].filter(Boolean).join(" ").toLowerCase().includes(query));
});

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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function radioDriverName(request) {
  const driver = request?.driver || {};
  const name = [driver.firstName, driver.lastName].filter(Boolean).join(" ").trim();
  return name || driver.email || shortMapId(request?.driverId);
}

function radioPriorityLabel(priority) {
  return {
    emergency: "Emergencia",
    active_ride: "Viaje activo",
    normal: "Normal",
  }[priority] || priority || "-";
}

function radioPriorityClass(priority) {
  return {
    emergency: "border-red-200 bg-red-50 text-red-700",
    active_ride: "border-amber-200 bg-amber-50 text-amber-800",
    normal: "border-slate-200 bg-slate-50 text-slate-700",
  }[priority] || "border-slate-200 bg-slate-50 text-slate-700";
}

function clampPanelWidth(value) {
  const viewportLimit = typeof window === "undefined"
    ? MAX_PANEL_WIDTH
    : Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 520));
  return Math.min(Math.max(Number(value) || DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH), viewportLimit);
}

function loadPanelWidth() {
  if (typeof window === "undefined") return;
  const saved = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
  if (saved) panelWidth.value = clampPanelWidth(saved);
}

function persistPanelWidth() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(panelWidth.value)));
}

function refreshMapSize() {
  window.setTimeout(() => map?.invalidateSize?.(), 0);
}

function stopPanelResize() {
  if (!isResizingPanel.value) return;
  isResizingPanel.value = false;
  persistPanelWidth();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  window.removeEventListener("pointermove", resizePanel);
  window.removeEventListener("pointerup", stopPanelResize);
  refreshMapSize();
}

function resizePanel(event) {
  const deltaX = event.clientX - resizeStartX;
  panelWidth.value = clampPanelWidth(resizeStartWidth - deltaX);
  refreshMapSize();
}

function startPanelResize(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  resizeStartX = event.clientX;
  resizeStartWidth = panelWidth.value;
  isResizingPanel.value = true;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", resizePanel);
  window.addEventListener("pointerup", stopPanelResize);
}

function isAssignable(driver) {
  return driver?.status === "online" && (!driver.lastSeenAt || !isDriverStale(driver));
}

function numberOrUndefined(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function locationFromFeature(feature) {
  const [lng, lat] = feature?.center || [];
  const location = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(location.lat) && Number.isFinite(location.lng) ? location : null;
}

async function geocodeAddress(address) {
  const query = String(address || "").trim();
  if (query.length < 3) return null;
  const params = new URLSearchParams({
    query: operationalSettings.formatLocalPlaceQuery(query),
  });
  const data = await apiRequest(`/api/places/geocode?${params.toString()}`, { method: "GET" });
  return locationFromFeature(data?.feature);
}

function resetServiceForm() {
  serviceForm.firstName = "";
  serviceForm.lastName = "";
  serviceForm.phoneNumber = "";
  serviceForm.serviceType = state.serviceTypes[0]?.code || "standard";
  serviceForm.pickupAddress = "";
  serviceForm.hasDestination = false;
  serviceForm.dropoffAddress = "";
  serviceForm.requestDescription = "";
  serviceForm.estimatedFareAmount = "";
  serviceForm.autoAssign = true;
  state.createError = "";
}

function openCreatePanel() {
  clearSelection();
  activeList.value = "requests";
  state.createPanelOpen = true;
  state.createError = "";
}

function closeCreatePanel() {
  state.createPanelOpen = false;
  state.createError = "";
}

async function createService() {
  state.creating = true;
  state.createError = "";
  try {
    const pickupLocation = await geocodeAddress(serviceForm.pickupAddress);
    if (!pickupLocation) {
      state.createError = "No se pudo ubicar el origen. Revisa la dirección.";
      return;
    }

    const dropoffLocation = serviceForm.hasDestination
      ? await geocodeAddress(serviceForm.dropoffAddress)
      : null;
    if (serviceForm.hasDestination && !dropoffLocation) {
      state.createError = "No se pudo ubicar el destino. Revisa la dirección.";
      return;
    }

    const result = await apiRequest("/api/rides", {
      method: "POST",
      body: {
        passenger: {
          phoneNumber: serviceForm.phoneNumber.trim(),
          firstName: serviceForm.firstName.trim() || undefined,
          lastName: serviceForm.lastName.trim() || undefined,
        },
        serviceType: serviceForm.serviceType,
        pickupAddress: serviceForm.pickupAddress.trim(),
        pickupLocation,
        hasDestination: serviceForm.hasDestination,
        dropoffAddress: serviceForm.hasDestination ? serviceForm.dropoffAddress.trim() : undefined,
        dropoffLocation: serviceForm.hasDestination ? dropoffLocation : undefined,
        requestDescription: serviceForm.requestDescription.trim() || undefined,
        estimatedFareAmount: numberOrUndefined(serviceForm.estimatedFareAmount),
        autoAssign: serviceForm.autoAssign,
        metadata: { source: "operator_panel" },
      },
    });

    resetServiceForm();
    state.createPanelOpen = false;
    await fetchSnapshot({ quiet: true });
    if (result?.ride?.id) {
      const created = state.requests.find((request) => request.id === result.ride.id);
      if (created) focusRequest(created);
    }
  } catch (error) {
    state.createError = error?.message || "No se pudo crear el servicio.";
  } finally {
    state.creating = false;
  }
}

async function fetchRadioRequests({ quiet = false } = {}) {
  if (!quiet) state.radioLoading = true;
  state.radioError = "";
  try {
    const params = new URLSearchParams({ status: "pending", limit: "50" });
    const data = await apiRequest(`/api/radio/requests?${params}`, { method: "GET" });
    state.radioRequests = data?.requests || [];
  } catch (error) {
    state.radioError = error?.message || "No se pudieron cargar las solicitudes de radio.";
  } finally {
    state.radioLoading = false;
  }
}

async function acceptRadioRequest(request) {
  if (!request?.id || state.radioActionId) return;
  if (radioModal.value?.isOpen) {
    state.radioError = "Finaliza o cierra la sesión de radio actual antes de aceptar otra solicitud.";
    return;
  }
  state.radioActionId = request.id;
  state.radioError = "";
  state.radioSuccess = "";
  try {
    const result = await apiRequest(`/api/radio/requests/${request.id}/accept`, { method: "POST" });
    await radioModal.value.openRadioModal({ request, session: result?.session || null });
    state.radioSuccess = `Solicitud aceptada para ${radioDriverName(request)}.`;
    await fetchRadioRequests({ quiet: true });
  } catch (error) {
    state.radioError = error?.message || "No se pudo aceptar la solicitud de radio.";
  } finally {
    state.radioActionId = "";
  }
}

async function rejectRadioRequest(request) {
  if (!request?.id) return;
  state.radioActionId = request.id;
  state.radioError = "";
  state.radioSuccess = "";
  try {
    await apiRequest(`/api/radio/requests/${request.id}/reject`, {
      method: "POST",
      body: { reason: "operator_busy" },
    });
    state.radioSuccess = `Solicitud rechazada para ${radioDriverName(request)}.`;
    await fetchRadioRequests({ quiet: true });
  } catch (error) {
    state.radioError = error?.message || "No se pudo rechazar la solicitud de radio.";
  } finally {
    state.radioActionId = "";
  }
}

function focusRadioDriver(request) {
  const driver = state.drivers.find((item) => item.userId === request?.driverId);
  if (driver) {
    focusDriver(driver);
    activeList.value = "drivers";
  }
}

function initMap() {
  if (map || !mapEl.value) return;
  const center = operationalSettings.mapCenter.value;
  map = L.map(mapEl.value, { zoomControl: false }).setView(
    [center.lat, center.lng],
    operationalSettings.mapDefaultZoom.value,
  );
  addBaseTileLayer(map);
  L.control.zoom({ position: "topright" }).addTo(map);
  map.createPane("operatorCoveragePane");
  map.getPane("operatorCoveragePane").style.zIndex = "580";
  map.getPane("operatorCoveragePane").style.pointerEvents = "none";
  map.createPane("operatorZonePane");
  map.getPane("operatorZonePane").style.zIndex = "600";
  map.createPane("operatorRequestPane");
  map.getPane("operatorRequestPane").style.zIndex = "650";
  map.createPane("operatorDriverPane");
  map.getPane("operatorDriverPane").style.zIndex = "750";
  coverageLayer = L.layerGroup().addTo(map);
  zoneLayer = L.layerGroup().addTo(map);
  requestLayer = L.layerGroup().addTo(map);
  driverLayer = L.layerGroup().addTo(map);
  map.on("click", clearSelection);
}

function renderMap({ fit = false } = {}) {
  if (!map) return;
  coverageLayer.clearLayers();
  zoneLayer.clearLayers();
  requestLayer.clearLayers();
  driverLayer.clearLayers();
  requestMarkers.clear();
  driverMarkers.clear();
  const bounds = [];

  if (layers.zones) {
    if (state.coverage) {
      const coverage = L.geoJSON(state.coverage, {
        pane: "operatorCoveragePane",
        interactive: false,
        style: {
          color: "#2563eb",
          fillColor: "#93c5fd",
          fillOpacity: 0.12,
          opacity: 0.95,
          weight: 4,
          dashArray: "8 6",
        },
      }).addTo(coverageLayer);
      const coverageBounds = coverage.getBounds();
      if (coverageBounds.isValid()) {
        bounds.push(coverageBounds.getSouthWest(), coverageBounds.getNorthEast());
      }
    }

    for (const zone of state.zones) {
      const zoneColor = zone.color || "#2563EB";
      const zoneStyle = {
        color: zoneColor,
        fillColor: zoneColor,
        fillOpacity: zone.status === "active" ? 0.18 : 0.08,
        weight: 2,
      };
      const zoneBounds = getZoneBounds(zone);

      for (const latLngs of getZoneLatLngRings(zone)) {
        const polygon = L.polygon(latLngs, {
          pane: "operatorZonePane",
          ...zoneStyle,
        })
          .bindPopup(`<strong>${escapeMapHtml(zone.name)}</strong><br>${escapeMapHtml(zone.type || "")}`)
          .addTo(zoneLayer);

        polygon.on("mouseover", () => polygon.setStyle({ fillOpacity: zone.status === "active" ? 0.24 : 0.12, weight: 3 }));
        polygon.on("mouseout", () => polygon.setStyle(zoneStyle));
      }

      if (zoneBounds?.isValid?.()) {
        bounds.push(zoneBounds.getSouthWest(), zoneBounds.getNorthEast());
      }
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
    for (const driver of visibleDrivers.value) {
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
    const [snapshotResponse, configuredZonesResponse] = await Promise.allSettled([
      apiRequest(`/api/admin/hot-zones?${params}`, { method: "GET" }),
      apiRequest("/api/admin/zones", { method: "GET" }),
    ]);
    if (snapshotResponse.status === "rejected") throw snapshotResponse.reason;

    const result = snapshotResponse.value;
    const configuredZonesResult = configuredZonesResponse.status === "fulfilled"
      ? configuredZonesResponse.value
      : null;
    const snapshotZonesById = new Map((result?.zones || []).map((zone) => [zone.id, zone]));
    const sourceZones = configuredZonesResult?.zones?.length
      ? configuredZonesResult.zones
      : (result?.zones || []);
    state.requests = result?.requests || [];
    state.drivers = (result?.drivers || []).map((driver) => ({
      ...driver,
      status: driver.status || "online",
      availabilityIntent: driver.availabilityIntent || "online",
    }));
    state.coverage = result?.coverage || null;
    state.zones = sourceZones.map((zone) => ({
      ...zone,
      metrics: snapshotZonesById.get(zone.id)?.metrics || {
        requests: 0,
        activeRequests: 0,
        availableDrivers: 0,
        totalDrivers: 0,
        averageWaitSeconds: 0,
        deficit: 0,
        level: "low",
      },
    }));
    state.serviceTypes = result?.serviceTypes || [];
    if (!state.serviceTypes.some((service) => service.code === serviceForm.serviceType)) {
      serviceForm.serviceType = state.serviceTypes[0]?.code || "standard";
    }
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
  state.createPanelOpen = false;
  loadRequestHistory(request.id);
  if (!request.pickupLocation) return;
  map?.setView([request.pickupLocation.lat, request.pickupLocation.lng], 17, { animate: true });
  requestMarkers.get(request.id)?.openTooltip();
}

function clearSelection() {
  state.selectedRequestId = null;
  state.selectedDriverId = null;
  state.createPanelOpen = false;
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
  state.selectedDriverId = driver.userId;
  state.selectedRequestId = null;
  state.createPanelOpen = false;
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
  renderMap({ fit: layer === "zones" && layers.zones });
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
  socket.on("operations:radio-request-created", () => fetchRadioRequests({ quiet: true }));
  socket.on("operations:radio-request-updated", () => fetchRadioRequests({ quiet: true }));
  socket.on("operations:radio-session-updated", () => fetchRadioRequests({ quiet: true }));
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
  loadPanelWidth();
  await operationalSettings.fetchOperationalSettings();
  await nextTick();
  initMap();
  await Promise.all([
    fetchSnapshot({ fit: true }),
    fetchRadioRequests(),
  ]);
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchSnapshot({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  stopPanelResize();
  window.clearInterval(refreshTimer);
  window.clearTimeout(refreshDebounce);
  socket?.disconnect();
  map?.remove();
});
</script>

<template>
  <section class="grid h-[calc(100vh-56px)] min-h-[680px] overflow-hidden bg-slate-100">
    <div
      class="grid min-h-0 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_6px_var(--operator-panel-width)]"
      :style="{ '--operator-panel-width': `${panelWidth}px` }"
    >
      <div class="relative min-h-0 overflow-hidden rounded-md border border-slate-200 bg-white">
        <div ref="mapEl" class="absolute inset-0" />
        <label class="absolute left-4 top-4 z-[500] w-[min(520px,calc(100%-2rem))]">
          <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            v-model="filters.search"
            class="h-10 w-full rounded-md border border-white/80 bg-white/95 pl-9 pr-3 text-sm shadow-lg outline-none backdrop-blur focus:border-slate-400"
            placeholder="Buscar solicitudes, conductores, placas, clientes o direcciones"
            type="search"
          />
        </label>
        <div class="absolute left-4 top-16 z-[500] flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-md border border-white/80 bg-white/95 p-2 shadow-lg backdrop-blur">
          <select v-model="filters.status" class="h-9 rounded-md border border-slate-200 px-3 text-sm">
            <option value="all">Todos los estados</option>
            <option value="pending_driver">Pendientes</option>
            <option value="driver_assigned">Asignadas</option>
            <option value="driver_en_route">En camino</option>
            <option value="in_progress">En curso</option>
          </select>
          <button class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm hover:bg-slate-50" type="button" @click="renderMap({ fit: true })">
            <LocateFixed class="h-4 w-4" />Centrar
          </button>
          <button class="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer('drivers')">
            <span :class="['grid h-4 w-4 place-items-center rounded border', layers.drivers ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300']"><Check v-if="layers.drivers" class="h-3 w-3" /></span>
            Conductores
          </button>
          <button class="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer('requests')">
            <span :class="['grid h-4 w-4 place-items-center rounded border', layers.requests ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-300']"><Check v-if="layers.requests" class="h-3 w-3" /></span>
            Solicitudes
          </button>
          <button class="inline-flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-100" type="button" @click="toggleLayer('zones')">
            <span :class="['grid h-4 w-4 place-items-center rounded border', layers.zones ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300']"><Check v-if="layers.zones" class="h-3 w-3" /></span>
            Zonas <span class="text-xs text-slate-500">({{ state.zones.length }})</span>
          </button>
        </div>
        <div class="absolute bottom-4 left-4 z-[500] flex flex-wrap items-center gap-3 rounded-md border border-white/80 bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-lg backdrop-blur">
          <span class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded-full bg-emerald-600" />Conductor disponible</span>
          <span class="inline-flex items-center gap-1.5"><MapPin class="h-4 w-4 text-rose-500" />Solicitud activa</span>
          <span class="inline-flex items-center gap-1.5"><span class="h-3 w-3 rounded border border-amber-400 bg-amber-100" />Zona operativa</span>
        </div>
        <button
          class="absolute bottom-4 right-4 z-[500] inline-flex h-11 items-center gap-2 rounded-full bg-amber-400 px-4 text-sm font-semibold text-slate-950 shadow-xl hover:bg-amber-300"
          type="button"
          @click="openCreatePanel"
        >
          <Plus class="h-4 w-4" />
          Crear servicio
        </button>
        <div v-if="state.error" class="absolute bottom-4 right-4 z-[600] rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{{ state.error }}</div>
        <div v-if="state.loading" class="absolute inset-0 z-[700] grid place-items-center bg-white/60 text-sm font-medium backdrop-blur-sm">Cargando operación...</div>
      </div>

      <div
        :class="[
          'relative hidden min-h-0 cursor-col-resize rounded-full bg-slate-200 transition-colors hover:bg-slate-400 lg:block',
          isResizingPanel ? 'bg-slate-500' : '',
        ]"
        role="separator"
        aria-orientation="vertical"
        title="Arrastra para cambiar el ancho del panel"
        @pointerdown="startPanelResize"
      >
        <span class="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-sm" />
      </div>

      <aside class="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div class="border-b border-slate-200 p-3">
          <div class="grid grid-cols-3 gap-2">
          <button :class="['rounded-md px-2 py-2 text-sm font-medium', activeList === 'requests' ? 'bg-slate-950 text-white' : 'text-slate-600']" type="button" @click="activeList = 'requests'">
            Solicitudes ({{ visibleRequests.length }})
          </button>
          <button :class="['rounded-md px-2 py-2 text-sm font-medium', activeList === 'drivers' ? 'bg-slate-950 text-white' : 'text-slate-600']" type="button" @click="activeList = 'drivers'">
            Conductores ({{ availableDrivers.length }})
          </button>
          <button :class="['rounded-md px-2 py-2 text-sm font-medium', activeList === 'radio' ? 'bg-slate-950 text-white' : 'text-slate-600']" type="button" @click="activeList = 'radio'">
            Radio ({{ state.radioRequests.length }})
          </button>
          </div>
        </div>

        <div v-if="selectedRequest" class="border-b border-slate-200 bg-slate-50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase text-emerald-700">Detalle de solicitud</p>
              <div class="mt-1 flex min-w-0 items-center gap-1">
                <h2 class="truncate font-semibold">#{{ shortMapId(selectedRequest.id) }}</h2>
                <button class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-900" type="button" title="Copiar ID" aria-label="Copiar ID" @click="copyText(selectedRequest.id)">
                  <Copy class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <button class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900" type="button" aria-label="Cerrar detalle" @click="clearSelection">
              <X class="h-4 w-4" />
            </button>
          </div>
          <span :class="['mt-3 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5', statusChipClass(selectedRequest.status)]">
            {{ statusLabel(selectedRequest.status) }}
          </span>
          <dl class="mt-3 grid gap-2 text-sm">
            <div><dt class="text-xs font-medium text-slate-500">Cliente</dt><dd class="mt-0.5 text-slate-900">{{ selectedRequest.clientName || "-" }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Origen</dt><dd class="mt-0.5 text-slate-900">{{ selectedRequest.pickupAddress || "-" }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Servicio</dt><dd class="mt-0.5 text-slate-900">{{ selectedRequest.serviceName || selectedRequest.serviceType || "-" }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Zona</dt><dd class="mt-0.5 text-slate-900">{{ selectedRequest.zoneName || "-" }}</dd></div>
          </dl>
          <div class="mt-4 border-t border-slate-200 pt-3">
            <div class="mb-2 flex items-center justify-between">
              <p class="text-xs font-semibold uppercase text-slate-500">Últimos estados</p>
              <button class="text-xs font-medium text-emerald-700 hover:text-emerald-900" type="button" @click="loadRequestHistory(selectedRequest.id)">Actualizar</button>
            </div>
            <p v-if="state.selectedRequestEventsLoading" class="text-sm text-slate-500">Cargando historial...</p>
            <p v-else-if="state.selectedRequestEventsError" class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ state.selectedRequestEventsError }}</p>
            <ol v-else-if="state.selectedRequestEvents.length" class="space-y-2">
              <li v-for="event in state.selectedRequestEvents" :key="event.id" class="flex items-center justify-between gap-2 text-xs">
                <span :class="['inline-flex items-center rounded-full border px-2 py-0.5 font-semibold', statusChipClass(event.status)]">{{ statusLabel(event.status) }}</span>
                <span class="text-slate-500">{{ formatEventTime(event.occurredAt || event.createdAt) }} · {{ actorLabel(event.actorType) }}</span>
              </li>
            </ol>
            <p v-else class="text-sm text-slate-500">No hay historial registrado para este servicio.</p>
          </div>
        </div>

        <div v-else-if="selectedDriver" class="border-b border-slate-200 bg-slate-50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase text-emerald-700">Detalle de conductor</p>
              <h2 class="mt-1 truncate font-semibold">{{ selectedDriver.name }}</h2>
            </div>
            <button class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-slate-900" type="button" aria-label="Cerrar detalle" @click="clearSelection">
              <X class="h-4 w-4" />
            </button>
          </div>
          <dl class="mt-3 grid gap-2 text-sm">
            <div><dt class="text-xs font-medium text-slate-500">Estado</dt><dd class="mt-0.5 text-slate-900">{{ driverPresenceLabel(selectedDriver) }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Vehículo</dt><dd class="mt-0.5 text-slate-900">{{ [selectedDriver.vehicle?.color, selectedDriver.vehicle?.make, selectedDriver.vehicle?.model].filter(Boolean).join(" ") || "-" }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Placa</dt><dd class="mt-0.5 text-slate-900">{{ selectedDriver.vehicle?.plate || "-" }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Zona</dt><dd class="mt-0.5 text-slate-900">{{ selectedDriver.zoneName || "-" }}</dd></div>
            <div><dt class="text-xs font-medium text-slate-500">Última ubicación</dt><dd class="mt-0.5 text-slate-900">{{ formatLastSeen(selectedDriver.lastSeenAt) }}</dd></div>
          </dl>
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

          <template v-else-if="activeList === 'drivers'">
            <button
              v-for="driver in visibleDrivers"
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
            <p v-if="!visibleDrivers.length && !state.loading" class="p-6 text-center text-sm text-slate-500">No hay conductores disponibles para los filtros seleccionados.</p>
          </template>

          <template v-else>
            <div class="border-b border-slate-100 p-3">
              <div class="flex items-center justify-between gap-2">
                <div>
                  <h3 class="text-sm font-semibold text-slate-950">Cola de radio</h3>
                  <p class="mt-0.5 text-xs text-slate-500">{{ visibleRadioRequests.length }} pendientes visibles</p>
                </div>
                <button class="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" type="button" title="Actualizar radio" aria-label="Actualizar radio" @click="fetchRadioRequests()">
                  <RefreshCw :class="['h-4 w-4', state.radioLoading ? 'animate-spin' : '']" />
                </button>
              </div>
              <p v-if="state.radioError" class="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ state.radioError }}</p>
              <p v-if="state.radioSuccess" class="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{{ state.radioSuccess }}</p>
            </div>

            <article
              v-for="request in visibleRadioRequests"
              :key="request.id"
              class="border-b border-slate-100 p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex min-w-0 items-center gap-2">
                    <Radio class="h-4 w-4 shrink-0 text-slate-500" />
                    <strong class="truncate text-sm">{{ radioDriverName(request) }}</strong>
                  </div>
                  <div class="mt-1 truncate text-xs text-slate-500">#{{ shortMapId(request.id) }} · {{ formatDate(request.createdAt) }}</div>
                </div>
                <span :class="['shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold', radioPriorityClass(request.priority)]">
                  {{ radioPriorityLabel(request.priority) }}
                </span>
              </div>
              <p v-if="request.reason" class="mt-2 text-sm text-slate-700">{{ request.reason }}</p>
              <div class="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  class="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  :disabled="!state.drivers.some((driver) => driver.userId === request.driverId)"
                  type="button"
                  @click="focusRadioDriver(request)"
                >
                  <MapPin class="h-3.5 w-3.5" />
                  Mapa
                </button>
                <button
                  class="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  :disabled="state.radioActionId === request.id"
                  type="button"
                  @click="rejectRadioRequest(request)"
                >
                  <X class="h-3.5 w-3.5" />
                  Rechazar
                </button>
                <button
                  class="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  :disabled="state.radioActionId === request.id"
                  type="button"
                  @click="acceptRadioRequest(request)"
                >
                  <PhoneCall class="h-3.5 w-3.5" />
                  Aceptar
                </button>
              </div>
            </article>
            <p v-if="!visibleRadioRequests.length && !state.radioLoading" class="p-6 text-center text-sm text-slate-500">No hay solicitudes de radio pendientes.</p>
          </template>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="state.createPanelOpen" class="fixed inset-0 z-[1800] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" @click.self="closeCreatePanel">
        <form class="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl" @submit.prevent="createService">
          <div class="shrink-0 border-b border-slate-200 bg-white p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase text-emerald-700">Nuevo servicio</p>
                <h2 class="mt-1 text-xl font-semibold">Crear solicitud</h2>
              </div>
              <button class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900" type="button" aria-label="Cerrar creación" @click="closeCreatePanel">
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-5">
            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1 text-xs font-medium text-slate-500">
                Nombre
                <input v-model.trim="serviceForm.firstName" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950" />
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-500">
                Apellido
                <input v-model.trim="serviceForm.lastName" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950" />
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-500 md:col-span-2">
                Teléfono
                <input v-model.trim="serviceForm.phoneNumber" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950" placeholder="+57..." required />
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-500 md:col-span-2">
                Tipo de servicio
                <select v-model="serviceForm.serviceType" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950">
                  <option v-for="service in state.serviceTypes" :key="service.code" :value="service.code">{{ service.name }}</option>
                  <option v-if="!state.serviceTypes.length" value="standard">Taxi</option>
                </select>
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-500 md:col-span-2">
                Origen
                <input v-model.trim="serviceForm.pickupAddress" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950" placeholder="Dirección de origen" required />
              </label>
              <label class="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input v-model="serviceForm.hasDestination" type="checkbox" />
                Agregar destino
              </label>
              <label v-if="serviceForm.hasDestination" class="grid gap-1 text-xs font-medium text-slate-500 md:col-span-2">
                Destino
                <input v-model.trim="serviceForm.dropoffAddress" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950" placeholder="Dirección de destino" required />
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-500 md:col-span-2">
                Indicaciones
                <textarea v-model.trim="serviceForm.requestDescription" class="min-h-20 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-950" placeholder="Referencia del punto, notas para conductor" />
              </label>
              <label class="grid gap-1 text-xs font-medium text-slate-500">
                Tarifa estimada
                <input v-model.trim="serviceForm.estimatedFareAmount" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-normal text-slate-950" placeholder="Opcional" inputmode="decimal" />
              </label>
              <label class="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                <input v-model="serviceForm.autoAssign" type="checkbox" />
                Ofertar automáticamente
              </label>
              <p v-if="state.createError" class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 md:col-span-2">{{ state.createError }}</p>
            </div>
          </div>

          <div class="shrink-0 border-t border-slate-200 bg-white p-4">
            <div class="flex justify-end gap-2">
              <button class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" @click="resetServiceForm">Limpiar</button>
              <button class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" :disabled="state.creating" type="submit">
                <Send class="h-4 w-4" />
                {{ state.creating ? "Creando..." : "Crear" }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Teleport>
    <OperatorRadioRequestsView ref="radioModal" modal-only />
  </section>
</template>
