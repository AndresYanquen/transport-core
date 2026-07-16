<script setup>
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AlertTriangle, Car, CheckCircle2, Clock3, Copy, LocateFixed, MapPin, Plus, RefreshCw, Search, XCircle } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const tabs = [
  { key: "overview", slug: "", label: "Vista general" },
  { key: "new_request", slug: "new-request", label: "Nueva Solicitud" },
  { key: "pending_requests", slug: "pending-requests", label: "Solicitudes Pendientes" },
  { key: "assigned_requests", slug: "assigned-requests", label: "Solicitudes Asignadas" },
  { key: "services_in_progress", slug: "services-in-progress", label: "Servicios En Curso" },
  { key: "completed_services", slug: "completed-services", label: "Servicios Finalizados" },
  { key: "canceled_services", slug: "canceled-services", label: "Servicios Cancelados" },
];

const tabAliases = Object.fromEntries(tabs.map((tab) => [tab.slug, tab.key]));
const terminalStatuses = ["completed", "canceled_by_client", "canceled_by_driver", "canceled_by_system", "no_show"];
const pendingStatuses = ["requested", "pending_driver"];
const assignedStatuses = ["driver_assigned", "driver_en_route", "driver_arrived"];
const inProgressStatuses = ["in_progress"];
const canceledStatuses = ["canceled_by_client", "canceled_by_driver", "canceled_by_system", "no_show"];
const tunjaCenter = { lat: 5.5353, lng: -73.3678 };

const statusLabels = {
  requested: "Solicitada",
  pending_driver: "Buscando conductor",
  driver_assigned: "Asignada",
  driver_en_route: "Conductor en camino",
  driver_arrived: "Conductor llegó",
  in_progress: "En curso",
  completed: "Finalizada",
  canceled_by_client: "Cancelada cliente",
  canceled_by_driver: "Cancelada conductor",
  canceled_by_system: "Cancelada sistema",
  no_show: "No show",
};

const state = reactive({
  loading: true,
  saving: false,
  resolvingPlace: false,
  error: "",
  success: "",
  toast: null,
  rides: [],
  serviceTypes: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

const form = reactive({
  clientId: "",
  firstName: "",
  lastName: "",
  phoneNumber: "",
  serviceType: "standard",
  pickupAddress: "",
  pickupLat: "",
  pickupLng: "",
  dropoffAddress: "",
  dropoffLat: "",
  dropoffLng: "",
  hasDestination: false,
  requestDescription: "",
  estimatedFareAmount: "",
  autoAssign: true,
});

function createPlaceSessionToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `place-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTunjaQuery(query) {
  const value = String(query || "").trim();
  return /tunja/i.test(value) ? value : `${value}, Tunja, Boyaca, Colombia`;
}

const placeState = reactive({
  pickup: {
    query: "",
    suggestions: [],
    selected: null,
    loading: false,
    error: "",
    debounceId: null,
    sessionToken: createPlaceSessionToken(),
  },
  dropoff: {
    query: "",
    suggestions: [],
    selected: null,
    loading: false,
    error: "",
    debounceId: null,
    sessionToken: createPlaceSessionToken(),
  },
});

const mapEl = ref(null);
let requestMap = null;
let pickupMarker = null;
let dropoffMarker = null;
let socket = null;
let refreshTimer = null;
let toastTimer = null;

function resolveRouteTab() {
  const param = Array.isArray(route.params.operationView) ? route.params.operationView[0] : route.params.operationView;
  return tabAliases[String(param || "").toLowerCase()] || "overview";
}

function setTab(tabKey) {
  const tab = tabs.find((item) => item.key === tabKey) || tabs[0];
  filters.tab = tab.key;
  router.replace(tab.slug ? `/operator/operacion/${tab.slug}` : "/operator/operacion");
}

async function fetchOperation({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const [ridesData, servicesData] = await Promise.all([
      apiRequest("/api/rides?limit=500&includePassenger=true&includeDriver=true", { method: "GET" }),
      apiRequest("/api/service-types", { method: "GET" }),
    ]);
    state.rides = ridesData?.rides || [];
    state.serviceTypes = servicesData?.serviceTypes || [];
    if (!state.serviceTypes.some((service) => service.code === form.serviceType)) {
      form.serviceType = state.serviceTypes[0]?.code || "standard";
    }
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    const message = err?.message || "No se pudo cargar la operación.";
    state.error = message;
    if (!quiet) showToast(message, "error");
  } finally {
    state.loading = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchOperation({ quiet: true }));
}

function resetForm() {
  form.clientId = "";
  form.firstName = "";
  form.lastName = "";
  form.phoneNumber = "";
  form.serviceType = state.serviceTypes[0]?.code || "standard";
  form.pickupAddress = "";
  form.pickupLat = "";
  form.pickupLng = "";
  form.dropoffAddress = "";
  form.dropoffLat = "";
  form.dropoffLng = "";
  form.hasDestination = false;
  form.requestDescription = "";
  form.estimatedFareAmount = "";
  form.autoAssign = true;
  resetPlacePicker("pickup");
  resetPlacePicker("dropoff");
  updateRequestMap();
}

function numberOrUndefined(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function showToast(message, type = "success") {
  state.toast = { message, type };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    toastTimer = null;
  }, 3200);
}

function resetPlacePicker(kind) {
  const picker = placeState[kind];
  if (picker?.debounceId) window.clearTimeout(picker.debounceId);
  picker.query = "";
  picker.suggestions = [];
  picker.selected = null;
  picker.loading = false;
  picker.error = "";
  picker.sessionToken = createPlaceSessionToken();
}

function locationFromFeature(feature) {
  const [lng, lat] = feature?.center || [];
  return {
    lat: Number(lat),
    lng: Number(lng),
  };
}

function isValidLocation(location) {
  return (
    Number.isFinite(location?.lat) &&
    Number.isFinite(location?.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}

function locationFromForm(latValue, lngValue) {
  if (String(latValue ?? "").trim() === "" || String(lngValue ?? "").trim() === "") {
    return null;
  }

  return {
    lat: Number(latValue),
    lng: Number(lngValue),
  };
}

function setPlaceField(kind, feature) {
  const picker = placeState[kind];
  const location = locationFromFeature(feature);
  if (!isValidLocation(location)) {
    picker.error = "La dirección seleccionada no tiene coordenadas válidas.";
    return;
  }

  const address = feature.placeName || feature.text || picker.query;
  picker.query = address;
  picker.selected = {
    id: feature.id,
    text: feature.text,
    placeName: feature.placeName,
    location,
  };
  picker.suggestions = [];
  picker.error = "";

  if (kind === "pickup") {
    form.pickupAddress = address;
    form.pickupLat = String(location.lat);
    form.pickupLng = String(location.lng);
  } else {
    form.dropoffAddress = address;
    form.dropoffLat = String(location.lat);
    form.dropoffLng = String(location.lng);
  }

  updateRequestMap();
}

async function fetchPlaceSuggestions(kind) {
  const picker = placeState[kind];
  const query = picker.query.trim();
  picker.error = "";
  picker.selected = null;

  if (kind === "pickup") {
    form.pickupAddress = query;
    form.pickupLat = "";
    form.pickupLng = "";
  } else {
    form.dropoffAddress = query;
    form.dropoffLat = "";
    form.dropoffLng = "";
  }
  updateRequestMap();

  if (query.length < 3) {
    picker.suggestions = [];
    return;
  }

  picker.loading = true;
  try {
    const params = new URLSearchParams({
      query: formatTunjaQuery(query),
      sessionToken: picker.sessionToken,
      lat: String(tunjaCenter.lat),
      lng: String(tunjaCenter.lng),
    });
    const data = await apiRequest(`/api/places/autocomplete?${params.toString()}`, { method: "GET" });
    picker.suggestions = data?.features || [];
  } catch (err) {
    // Autocomplete is a convenience. The final submit/Enter path can still
    // resolve the typed address through geocode, so avoid showing transient
    // Google autocomplete errors while the operator is typing.
    picker.suggestions = [];
  } finally {
    picker.loading = false;
  }
}

async function geocodeTypedAddress(kind) {
  const picker = placeState[kind];
  const query = picker.query.trim();
  if (query.length < 3) return null;

  picker.loading = true;
  picker.error = "";
  try {
    const params = new URLSearchParams({ query: formatTunjaQuery(query) });
    const data = await apiRequest(`/api/places/geocode?${params.toString()}`, { method: "GET" });
    setPlaceField(kind, data?.feature);
    return placeState[kind].selected;
  } catch (err) {
    picker.error = err?.message || "No se pudo geocodificar la dirección.";
    return null;
  } finally {
    picker.loading = false;
  }
}

function schedulePlaceSuggestions(kind) {
  const picker = placeState[kind];
  if (picker.debounceId) window.clearTimeout(picker.debounceId);
  picker.debounceId = window.setTimeout(() => fetchPlaceSuggestions(kind), 350);
}

function hidePlaceSuggestions(kind) {
  window.setTimeout(() => {
    placeState[kind].suggestions = [];
  }, 180);
}

async function reverseGeocodeLocation(kind, location) {
  if (!isValidLocation(location)) return null;
  const picker = placeState[kind];
  picker.loading = true;
  picker.error = "";

  try {
    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
    });
    const data = await apiRequest(`/api/places/reverse-geocode?${params.toString()}`, { method: "GET" });
    setPlaceField(kind, data?.feature);
    return placeState[kind].selected;
  } catch (err) {
    picker.error = err?.message || "No se pudo resolver la dirección del punto seleccionado.";
    return null;
  } finally {
    picker.loading = false;
  }
}

async function selectPlace(kind, suggestion) {
  const picker = placeState[kind];
  picker.loading = true;
  picker.error = "";
  try {
    const params = new URLSearchParams({ placeId: suggestion.id, sessionToken: picker.sessionToken });
    const data = await apiRequest(`/api/places/details?${params.toString()}`, { method: "GET" });
    setPlaceField(kind, data?.feature);
  } catch (err) {
    const fallback = await geocodeTypedAddress(kind);
    if (!fallback) picker.error = err?.message || "No se pudo resolver la dirección.";
  } finally {
    picker.loading = false;
  }
}

async function resolveTypedAddress(kind) {
  const picker = placeState[kind];
  if (picker.selected) return picker.selected;

  const query = picker.query.trim();
  if (query.length < 3) {
    picker.error = "Ingresa una dirección válida y selecciona una sugerencia.";
    return null;
  }

  state.resolvingPlace = true;
  picker.loading = true;
  picker.error = "";
  try {
    const params = new URLSearchParams({
      query: formatTunjaQuery(query),
      sessionToken: picker.sessionToken,
      lat: String(tunjaCenter.lat),
      lng: String(tunjaCenter.lng),
    });
    const data = await apiRequest(`/api/places/autocomplete?${params.toString()}`, { method: "GET" });
    const [first] = data?.features || [];
    if (!first) {
      return geocodeTypedAddress(kind);
    }
    await selectPlace(kind, first);
    return placeState[kind].selected;
  } catch (err) {
    const fallback = await geocodeTypedAddress(kind);
    if (fallback) return fallback;
    picker.error = err?.message || "No se pudo resolver la dirección.";
    return fallback;
  } finally {
    picker.loading = false;
    state.resolvingPlace = false;
  }
}

async function ensureResolvedLocations() {
  const pickup = await resolveTypedAddress("pickup");
  if (!pickup) return false;

  if (!form.hasDestination) {
    form.dropoffAddress = "";
    form.dropoffLat = "";
    form.dropoffLng = "";
    resetPlacePicker("dropoff");
    updateRequestMap();
    return true;
  }

  const dropoff = await resolveTypedAddress("dropoff");
  return Boolean(dropoff);
}

function buildPayload() {
  const payload = {
    clientId: form.clientId.trim() || undefined,
    passenger: form.clientId.trim()
      ? undefined
      : {
          phoneNumber: form.phoneNumber.trim(),
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
        },
    serviceType: form.serviceType,
    pickupAddress: form.pickupAddress.trim(),
    pickupLocation: {
      lat: Number(form.pickupLat),
      lng: Number(form.pickupLng),
    },
    hasDestination: form.hasDestination,
    dropoffAddress: form.hasDestination ? form.dropoffAddress.trim() : undefined,
    dropoffLocation: form.hasDestination
      ? {
          lat: Number(form.dropoffLat),
          lng: Number(form.dropoffLng),
        }
      : undefined,
    requestDescription: form.requestDescription.trim() || undefined,
    estimatedFareAmount: numberOrUndefined(form.estimatedFareAmount),
    autoAssign: form.autoAssign,
    metadata: { source: "operator_panel" },
  };

  return payload;
}

async function createRequest() {
  state.saving = true;
  state.error = "";
  state.success = "";

  try {
    const hasLocations = await ensureResolvedLocations();
    if (!hasLocations) {
      const message = "Selecciona direcciones válidas para crear la solicitud.";
      state.error = message;
      showToast(message, "error");
      return;
    }
    const result = await apiRequest("/api/rides", {
      method: "POST",
      body: buildPayload(),
    });
    state.success = `Solicitud creada #${shortId(result?.ride?.id)}${result?.assignmentError ? ` · ${result.assignmentError}` : ""}`;
    showToast(state.success, result?.assignmentError ? "warning" : "success");
    resetForm();
    await fetchOperation({ quiet: true });
    setTab("pending_requests");
  } catch (err) {
    state.error = err?.message || "No se pudo crear la solicitud.";
    showToast(state.error, "error");
  } finally {
    state.saving = false;
  }
}

function initRequestMap() {
  if (!mapEl.value || requestMap) return;
  requestMap = L.map(mapEl.value, { zoomControl: true }).setView([tunjaCenter.lat, tunjaCenter.lng], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(requestMap);
}

function destroyRequestMap() {
  if (!requestMap) return;
  requestMap.remove();
  requestMap = null;
  pickupMarker = null;
  dropoffMarker = null;
}

function onPickupMarkerDragEnd(event) {
  const point = event.target.getLatLng();
  const location = { lat: point.lat, lng: point.lng };
  if (!isValidLocation(location)) return;

  form.pickupLat = String(location.lat);
  form.pickupLng = String(location.lng);
  form.pickupAddress = "Resolviendo dirección...";
  placeState.pickup.query = form.pickupAddress;
  placeState.pickup.selected = null;
  placeState.pickup.suggestions = [];
  reverseGeocodeLocation("pickup", location);
}

function upsertMarker(existingMarker, location, label, options = {}) {
  if (!isValidLocation(location)) {
    if (existingMarker) {
      existingMarker.remove();
    }
    return null;
  }

  const latLng = [location.lat, location.lng];
  if (existingMarker) {
    existingMarker.setLatLng(latLng).bindTooltip(label);
    if (options.draggable && !existingMarker.dragging?.enabled()) {
      existingMarker.dragging?.enable();
    }
    if (!options.draggable && existingMarker.dragging?.enabled()) {
      existingMarker.dragging?.disable();
    }
    return existingMarker;
  }

  const icon = L.divIcon({
    className: "",
    html: `<div class="grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-slate-950 text-xs font-semibold text-white shadow">${label.slice(0, 1)}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  const marker = L.marker(latLng, { icon, draggable: Boolean(options.draggable) }).addTo(requestMap).bindTooltip(label);
  if (options.onDragEnd) {
    marker.on("dragend", options.onDragEnd);
  }
  return marker;
}

function updateRequestMap() {
  nextTick(() => {
    initRequestMap();
    if (!requestMap) return;

    const pickupLocation = locationFromForm(form.pickupLat, form.pickupLng);
    const dropoffLocation = locationFromForm(form.dropoffLat, form.dropoffLng);
    pickupMarker = upsertMarker(pickupMarker, pickupLocation, "Origen", {
      draggable: true,
      onDragEnd: onPickupMarkerDragEnd,
    });
    dropoffMarker = form.hasDestination ? upsertMarker(dropoffMarker, dropoffLocation, "Destino") : upsertMarker(dropoffMarker, null, "Destino");

    const bounds = [];
    if (isValidLocation(pickupLocation)) bounds.push([pickupLocation.lat, pickupLocation.lng]);
    if (form.hasDestination && isValidLocation(dropoffLocation)) bounds.push([dropoffLocation.lat, dropoffLocation.lng]);

    if (bounds.length === 1) {
      requestMap.setView(bounds[0], 16);
    } else if (bounds.length > 1) {
      requestMap.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
    } else {
      requestMap.setView([tunjaCenter.lat, tunjaCenter.lng], 14);
    }
    requestMap.invalidateSize();
    window.setTimeout(() => requestMap?.invalidateSize(), 80);
    window.setTimeout(() => requestMap?.invalidateSize(), 250);
  });
}

function parseMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isToday(value) {
  const ms = parseMs(value);
  if (!ms) return false;
  const date = new Date(ms);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function summaryDateForRide(ride) {
  if (ride.status === "completed") return ride.completedAt || ride.updatedAt || ride.requestedAt;
  if (canceledStatuses.includes(ride.status)) return ride.canceledAt || ride.updatedAt || ride.requestedAt;
  if (inProgressStatuses.includes(ride.status)) return ride.startedAt || ride.updatedAt || ride.requestedAt;
  if (assignedStatuses.includes(ride.status)) {
    return ride.acceptedAt || ride.driverArrivedAt || ride.updatedAt || ride.requestedAt;
  }
  return ride.requestedAt || ride.updatedAt;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
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
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    state.success = "ID de solicitud copiado";
    showToast(state.success);
  } catch (_err) {
    state.error = "No se pudo copiar el ID de la solicitud.";
    showToast(state.error, "error");
  }
}

function passengerName(ride) {
  const passenger = ride.passenger || ride.client || {};
  const name = passenger.fullName || [passenger.firstName, passenger.lastName].filter(Boolean).join(" ").trim();
  return name || passenger.phoneNumber || passenger.email || shortId(ride.clientId);
}

function statusLabel(status) {
  return statusLabels[status] || status || "-";
}

function serviceName(code) {
  return state.serviceTypes.find((service) => service.code === code)?.name || code || "-";
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function collectSearchValues(value, values = []) {
  if (value === null || value === undefined) return values;
  if (value instanceof Date) {
    values.push(formatDate(value));
    return values;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSearchValues(item, values));
    return values;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectSearchValues(item, values));
    return values;
  }
  values.push(value);
  return values;
}

function rideSearchText(ride) {
  const passenger = ride.passenger || ride.client || {};
  const driver = ride.driver || {};
  const values = collectSearchValues(ride);

  values.push(
    shortId(ride.id),
    passengerName(ride),
    statusLabel(ride.status),
    serviceName(ride.serviceType),
    formatDate(ride.requestedAt),
    formatDate(ride.updatedAt),
    formatDate(ride.acceptedAt),
    formatDate(ride.driverArrivedAt),
    formatDate(ride.startedAt),
    formatDate(ride.completedAt),
    formatDate(ride.canceledAt),
    driver.fullName,
    [driver.firstName, driver.lastName].filter(Boolean).join(" "),
    driver.email,
    driver.phoneNumber,
    driver.vehiclePlate,
    driver.vehicleMake,
    driver.vehicleModel,
    passenger.fullName,
    [passenger.firstName, passenger.lastName].filter(Boolean).join(" "),
    passenger.email,
    passenger.phoneNumber,
  );

  return normalizeSearchText(values.filter(Boolean).join(" "));
}

function matchesSearch(ride) {
  const query = normalizeSearchText(filters.search.trim());
  if (!query) return true;
  return rideSearchText(ride).includes(query);
}

const sortedRides = computed(() =>
  [...state.rides].sort((a, b) => parseMs(b.updatedAt || b.requestedAt) - parseMs(a.updatedAt || a.requestedAt)),
);
const pendingRides = computed(() => sortedRides.value.filter((ride) => pendingStatuses.includes(ride.status)));
const assignedRides = computed(() => sortedRides.value.filter((ride) => assignedStatuses.includes(ride.status)));
const inProgressRides = computed(() => sortedRides.value.filter((ride) => inProgressStatuses.includes(ride.status)));
const completedRides = computed(() => sortedRides.value.filter((ride) => ride.status === "completed"));
const canceledRides = computed(() => sortedRides.value.filter((ride) => canceledStatuses.includes(ride.status)));
const activeRides = computed(() => sortedRides.value.filter((ride) => !terminalStatuses.includes(ride.status)));
const todaySummaryRides = computed(() => sortedRides.value.filter((ride) => isToday(summaryDateForRide(ride))));
const todayPendingRides = computed(() => todaySummaryRides.value.filter((ride) => pendingStatuses.includes(ride.status)));
const todayAssignedRides = computed(() => todaySummaryRides.value.filter((ride) => assignedStatuses.includes(ride.status)));
const todayInProgressRides = computed(() => todaySummaryRides.value.filter((ride) => inProgressStatuses.includes(ride.status)));
const todayCompletedRides = computed(() => todaySummaryRides.value.filter((ride) => ride.status === "completed"));
const todayCanceledRides = computed(() => todaySummaryRides.value.filter((ride) => canceledStatuses.includes(ride.status)));

const summary = computed(() => [
  { label: "Pendientes hoy", value: todayPendingRides.value.length, icon: Clock3 },
  { label: "Asignadas hoy", value: todayAssignedRides.value.length, icon: Car },
  { label: "En curso hoy", value: todayInProgressRides.value.length, icon: AlertTriangle },
  { label: "Finalizadas hoy", value: todayCompletedRides.value.length, icon: CheckCircle2 },
  { label: "Canceladas hoy", value: todayCanceledRides.value.length, icon: XCircle },
]);

const tabRides = computed(() => {
  if (filters.tab === "pending_requests") return pendingRides.value;
  if (filters.tab === "assigned_requests") return assignedRides.value;
  if (filters.tab === "services_in_progress") return inProgressRides.value;
  if (filters.tab === "completed_services") return completedRides.value;
  if (filters.tab === "canceled_services") return canceledRides.value;
  return activeRides.value;
});

const searchQuery = computed(() => filters.search.trim());
const searchActive = computed(() => searchQuery.value.length > 0);
const globalSearchRides = computed(() => sortedRides.value.filter(matchesSearch));
const recentRides = computed(() => (searchActive.value ? globalSearchRides.value : sortedRides.value).slice(0, 6));
const visibleRides = computed(() => tabRides.value.filter(matchesSearch));
const globalSearchCounts = computed(() => ({
  all: globalSearchRides.value.length,
  pending: pendingRides.value.filter(matchesSearch).length,
  assigned: assignedRides.value.filter(matchesSearch).length,
  inProgress: inProgressRides.value.filter(matchesSearch).length,
  completed: completedRides.value.filter(matchesSearch).length,
  canceled: canceledRides.value.filter(matchesSearch).length,
}));

watch(
  () => route.params.operationView,
  () => {
    filters.tab = resolveRouteTab();
  },
);

watch(
  () => filters.tab,
  (tab) => {
    if (tab === "new_request") {
      updateRequestMap();
      return;
    }
    destroyRequestMap();
  },
  { flush: "post" },
);

watch(
  () => form.hasDestination,
  (hasDestination) => {
    if (!hasDestination) {
      form.dropoffAddress = "";
      form.dropoffLat = "";
      form.dropoffLng = "";
      resetPlacePicker("dropoff");
    }
    updateRequestMap();
  },
);

onMounted(() => {
  fetchOperation();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchOperation({ quiet: true }), 30000);
  if (filters.tab === "new_request") updateRequestMap();
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  if (socket) socket.disconnect();
  ["pickup", "dropoff"].forEach((kind) => {
    if (placeState[kind].debounceId) window.clearTimeout(placeState[kind].debounceId);
  });
  destroyRequestMap();
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="state.toast"
        :class="[
          'fixed right-4 top-4 z-[1600] max-w-md rounded-md border px-4 py-3 text-sm shadow-lg',
          state.toast.type === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-800'
            : state.toast.type === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800',
        ]"
        role="status"
      >
        {{ state.toast.message }}
      </div>
    </Transition>

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Operación</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Centro de solicitudes</h1>
        <p class="mt-1 text-sm text-slate-500">Crea servicios telefónicos y monitorea solicitudes en tiempo real.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchOperation()"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div class="rounded-md border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'rounded-md px-3 py-2 text-sm font-medium transition',
              filters.tab === tab.key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
            ]"
            type="button"
            @click="setTab(tab.key)"
          >
            {{ tab.label }}
          </button>
        </div>
        <label class="relative min-w-64 flex-1 md:max-w-md">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model.trim="filters.search"
            class="h-9 w-full rounded-md border border-slate-200 pl-9 pr-9 text-sm outline-none focus:border-slate-400"
            placeholder="Buscar en todas las solicitudes"
            type="search"
          />
          <button
            v-if="filters.search"
            class="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
            type="button"
            aria-label="Limpiar búsqueda"
            @click="filters.search = ''"
          >
            ×
          </button>
        </label>
      </div>

      <div class="p-4">
        <div v-if="filters.tab === 'overview'" class="grid gap-4">
          <div class="grid gap-3 md:grid-cols-5">
            <article v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 p-4">
              <component :is="item.icon" class="h-5 w-5 text-slate-500" />
              <div class="mt-3 text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
              <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
            </article>
          </div>

          <div class="grid gap-4 lg:grid-cols-[360px_1fr]">
            <section class="rounded-md border border-slate-200 p-4">
              <h2 class="font-semibold text-slate-950">Nueva solicitud</h2>
              <p class="mt-1 text-sm text-slate-500">Crear servicio y ofertarlo a conductores.</p>
              <button class="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800" type="button" @click="setTab('new_request')">
                <Plus class="h-4 w-4" />
                Nueva solicitud
              </button>
            </section>

            <section class="rounded-md border border-slate-200 p-4">
              <h2 class="font-semibold text-slate-950">Actividad reciente</h2>
              <div class="mt-3 grid gap-2">
                <div v-if="searchActive" class="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {{ globalSearchCounts.all }} coincidencias ·
                  {{ globalSearchCounts.pending }} pendientes ·
                  {{ globalSearchCounts.assigned }} asignadas ·
                  {{ globalSearchCounts.inProgress }} en curso ·
                  {{ globalSearchCounts.completed }} finalizadas ·
                  {{ globalSearchCounts.canceled }} canceladas
                </div>
                <div v-for="ride in recentRides" :key="ride.id" class="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-1">
                      <span class="truncate text-sm font-medium text-slate-900">#{{ shortId(ride.id) }} · {{ passengerName(ride) }}</span>
                      <button
                        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                        type="button"
                        title="Copiar ID de solicitud"
                        aria-label="Copiar ID de solicitud"
                        @click="copyText(ride.id)"
                      >
                        <Copy class="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div class="truncate text-xs text-slate-500">{{ ride.pickupAddress }}</div>
                  </div>
                  <div class="text-right text-xs text-slate-500">
                    <div class="font-medium text-slate-700">{{ statusLabel(ride.status) }}</div>
                    <div>{{ formatDate(ride.updatedAt || ride.requestedAt) }}</div>
                  </div>
                </div>
                <div v-if="!state.loading && !recentRides.length" class="py-6 text-center text-sm text-slate-500">
                  {{ searchActive ? "No hay coincidencias para la búsqueda." : "Sin solicitudes registradas." }}
                </div>
              </div>
            </section>
          </div>
        </div>

        <form v-else-if="filters.tab === 'new_request'" class="grid gap-4 lg:grid-cols-2" @submit.prevent="createRequest">
          <section class="rounded-md border border-slate-200 p-4">
            <h2 class="font-semibold text-slate-950">Cliente</h2>
            <div class="mt-3 grid gap-3">
              <label class="grid gap-1 text-sm text-slate-600">
                <span>ID cliente existente</span>
                <input v-model.trim="form.clientId" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950" placeholder="Opcional" />
              </label>
              <div class="grid gap-3 md:grid-cols-2">
                <label class="grid gap-1 text-sm text-slate-600">
                  <span>Nombre</span>
                  <input v-model.trim="form.firstName" :disabled="Boolean(form.clientId)" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950 disabled:bg-slate-50" />
                </label>
                <label class="grid gap-1 text-sm text-slate-600">
                  <span>Apellido</span>
                  <input v-model.trim="form.lastName" :disabled="Boolean(form.clientId)" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950 disabled:bg-slate-50" />
                </label>
              </div>
              <label class="grid gap-1 text-sm text-slate-600">
                <span>Teléfono</span>
                <input v-model.trim="form.phoneNumber" :disabled="Boolean(form.clientId)" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950 disabled:bg-slate-50" placeholder="+57..." />
              </label>
            </div>
          </section>

          <section class="rounded-md border border-slate-200 p-4">
            <h2 class="font-semibold text-slate-950">Servicio</h2>
            <div class="mt-3 grid gap-3">
              <label class="grid gap-1 text-sm text-slate-600">
                <span>Tipo de servicio</span>
                <select v-model="form.serviceType" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950">
                  <option v-for="service in state.serviceTypes" :key="service.code" :value="service.code">{{ service.name }}</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-sm text-slate-700">
                <input v-model="form.autoAssign" type="checkbox" />
                Ofertar automáticamente a conductores disponibles
              </label>
              <label class="grid gap-1 text-sm text-slate-600">
                <span>Indicaciones extras</span>
                <textarea
                  v-model.trim="form.requestDescription"
                  class="min-h-20 rounded-md border border-slate-200 px-3 py-2 text-slate-950"
                  placeholder="Ej. recoger en portería, llamar al llegar, llevar efectivo, referencias del punto"
                />
                <span class="text-xs text-slate-500">Se enviarán al conductor junto con la solicitud.</span>
              </label>
            </div>
          </section>

          <section class="rounded-md border border-slate-200 p-4">
            <h2 class="font-semibold text-slate-950">Origen</h2>
            <div class="mt-3 grid gap-3">
              <label class="relative grid gap-1 text-sm text-slate-600">
                <span>Dirección origen</span>
                <input
                  v-model="placeState.pickup.query"
                  class="h-9 rounded-md border border-slate-200 px-3 pr-9 text-slate-950"
                  placeholder="Ej. Calle 12 # 7-20, Tunja"
                  autocomplete="off"
                  required
                  @input="schedulePlaceSuggestions('pickup')"
                  @blur="hidePlaceSuggestions('pickup')"
                />
                <LocateFixed v-if="placeState.pickup.loading" class="absolute bottom-2 right-3 h-4 w-4 animate-spin text-slate-400" />
                <div
                  v-if="placeState.pickup.suggestions.length"
                  class="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    v-for="suggestion in placeState.pickup.suggestions"
                    :key="suggestion.id"
                    class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    type="button"
                    @mousedown.prevent="selectPlace('pickup', suggestion)"
                  >
                    <MapPin class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span>
                      <span class="block font-medium text-slate-900">{{ suggestion.text }}</span>
                      <span class="block text-xs text-slate-500">{{ suggestion.placeName }}</span>
                    </span>
                  </button>
                </div>
              </label>
              <div v-if="placeState.pickup.selected" class="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Origen confirmado: {{ placeState.pickup.selected.placeName }}
              </div>
              <div v-else class="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Selecciona una sugerencia para fijar el punto en el mapa.
              </div>
              <div v-if="placeState.pickup.error" class="text-xs text-rose-700">{{ placeState.pickup.error }}</div>
              <div class="sr-only">
                <input v-model.trim="form.pickupLat" />
                <input v-model.trim="form.pickupLng" />
              </div>
            </div>
          </section>

          <section class="rounded-md border border-slate-200 p-4">
            <h2 class="font-semibold text-slate-950">Destino</h2>
            <div class="mt-3 grid gap-3">
              <label class="flex items-center gap-2 text-sm text-slate-700">
                <input v-model="form.hasDestination" type="checkbox" />
                Tiene destino
              </label>
              <label class="relative grid gap-1 text-sm text-slate-600">
                <span>Dirección destino</span>
                <input
                  v-model="placeState.dropoff.query"
                  :disabled="!form.hasDestination"
                  class="h-9 rounded-md border border-slate-200 px-3 pr-9 text-slate-950 disabled:bg-slate-50"
                  placeholder="Ej. Terminal de Transportes"
                  autocomplete="off"
                  @input="schedulePlaceSuggestions('dropoff')"
                  @blur="hidePlaceSuggestions('dropoff')"
                />
                <LocateFixed v-if="placeState.dropoff.loading" class="absolute bottom-2 right-3 h-4 w-4 animate-spin text-slate-400" />
                <div
                  v-if="form.hasDestination && placeState.dropoff.suggestions.length"
                  class="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    v-for="suggestion in placeState.dropoff.suggestions"
                    :key="suggestion.id"
                    class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    type="button"
                    @mousedown.prevent="selectPlace('dropoff', suggestion)"
                  >
                    <MapPin class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span>
                      <span class="block font-medium text-slate-900">{{ suggestion.text }}</span>
                      <span class="block text-xs text-slate-500">{{ suggestion.placeName }}</span>
                    </span>
                  </button>
                </div>
              </label>
              <div v-if="form.hasDestination && placeState.dropoff.selected" class="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Destino confirmado: {{ placeState.dropoff.selected.placeName }}
              </div>
              <div v-else-if="form.hasDestination" class="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Selecciona una sugerencia para fijar el destino.
              </div>
              <div v-if="placeState.dropoff.error" class="text-xs text-rose-700">{{ placeState.dropoff.error }}</div>
              <div class="sr-only">
                <input v-model.trim="form.dropoffLat" />
                <input v-model.trim="form.dropoffLng" />
              </div>
              <label class="grid gap-1 text-sm text-slate-600">
                <span>Tarifa estimada</span>
                <input v-model.trim="form.estimatedFareAmount" class="h-9 rounded-md border border-slate-200 px-3" placeholder="Opcional" />
              </label>
            </div>
          </section>

          <section class="lg:col-span-2 rounded-md border border-slate-200 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold text-slate-950">Mapa de la solicitud</h2>
              <span class="text-xs text-slate-500">Arrastra el punto de origen para ajustar la dirección.</span>
            </div>
            <div ref="mapEl" class="mt-3 h-80 overflow-hidden rounded-md border border-slate-200 bg-slate-100"></div>
          </section>

          <div class="lg:col-span-2 flex justify-end gap-2">
            <button class="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" @click="resetForm">Limpiar</button>
            <button class="h-9 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" :disabled="state.saving || state.resolvingPlace" type="submit">
              {{ state.saving || state.resolvingPlace ? "Creando..." : "Crear y ofertar" }}
            </button>
          </div>
        </form>

        <section v-else class="grid gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold text-slate-950">{{ tabs.find((tab) => tab.key === filters.tab)?.label }}</h2>
            <span v-if="searchActive" class="text-sm text-slate-500">
              {{ visibleRides.length }} coincidencias en esta pestaña · {{ globalSearchCounts.all }} en total
            </span>
          </div>
          <div class="overflow-x-auto rounded-md border border-slate-200">
            <table class="w-full min-w-[900px] text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th class="px-4 py-3">Solicitud</th><th>Cliente</th><th>Estado</th><th>Origen</th><th>Destino</th><th>Fecha</th></tr>
              </thead>
              <tbody>
                <tr v-for="ride in visibleRides" :key="ride.id" class="border-b border-slate-100 hover:bg-slate-50">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-1">
                      <span class="font-mono text-xs">#{{ shortId(ride.id) }}</span>
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
                  </td>
                  <td class="px-4 py-3">{{ passengerName(ride) }}</td>
                  <td class="px-4 py-3">{{ statusLabel(ride.status) }}</td>
                  <td class="px-4 py-3">{{ ride.pickupAddress || "-" }}</td>
                  <td class="px-4 py-3">{{ ride.dropoffAddress || "-" }}</td>
                  <td class="px-4 py-3 text-slate-600">{{ formatDate(ride.requestedAt) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="!state.loading && !visibleRides.length" class="py-10 text-center text-sm text-slate-500">No hay solicitudes para esta vista.</div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
