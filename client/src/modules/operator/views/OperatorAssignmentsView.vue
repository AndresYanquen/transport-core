<script setup>
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Clock3,
  Copy,
  History,
  MapPin,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  UserPlus,
  X,
} from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { createRealtimeSocket } from "../../../services/realtime.js";
import { useAuthStore } from "../../../stores/auth.js";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const operationalSettings = useOperationalSettings();

const tabs = [
  { key: "assign", slug: "assign-driver", label: "Asignar Conductor" },
  { key: "reassign", slug: "reassign-service", label: "Reasignar Servicio" },
  { key: "no_response", slug: "no-response", label: "Sin Respuesta" },
  { key: "history", slug: "history", label: "Historial" },
];

const tabAliases = {
  ...Object.fromEntries(tabs.map((tab) => [tab.slug, tab.key])),
  "asignar-conductor": "assign",
  "reasignar-servicio": "reassign",
  "sin-respuesta": "no_response",
  historial: "history",
};
const assignableStatuses = ["requested", "pending_driver"];
const reassignableStatuses = ["driver_assigned", "driver_en_route", "driver_arrived"];
const noResponseInviteStatuses = ["pending", "rejected", "expired"];

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

const inviteLabels = {
  pending: "Pendiente",
  accepted: "Aceptada",
  rejected: "Rechazada",
  expired: "Expirada",
};

const state = reactive({
  loading: true,
  loadingNearby: false,
  savingRideId: "",
  error: "",
  toast: null,
  rides: [],
  events: [],
  invitesByRideId: {},
  nearbyDrivers: [],
  selectedRideId: "",
  radiusMeters: 5000,
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
});

const mapEl = ref(null);
let assignmentMap = null;
let pickupMarker = null;
let radiusCircle = null;
let driverMarkers = [];
let socket = null;
let refreshTimer = null;
let toastTimer = null;

function resolveRouteTab() {
  const param = Array.isArray(route.params.assignmentView)
    ? route.params.assignmentView[0]
    : route.params.assignmentView;
  return tabAliases[String(param || "").toLowerCase()] || "assign";
}

function setTab(tabKey) {
  const tab = tabs.find((item) => item.key === tabKey) || tabs[0];
  filters.tab = tab.key;
  router.replace(`/operator/asignaciones/${tab.slug}`);
}

function showToast(message, type = "success") {
  state.toast = { message, type };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    toastTimer = null;
  }, 2600);
}

async function fetchAssignments({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  state.error = "";

  try {
    const [ridesData, eventsData] = await Promise.all([
      apiRequest("/api/rides?limit=500&includePassenger=true&includeDriver=true", { method: "GET" }),
      apiRequest("/api/rides/events/recent?limit=100", { method: "GET" }),
    ]);

    state.rides = ridesData?.rides || [];
    state.events = eventsData?.events || [];
    state.lastUpdatedAt = new Date().toISOString();
    await fetchNoResponseInvites();

    if (!selectedRide.value && assignRows.value.length) {
      await selectRide(assignRows.value[0], { recenter: false });
    } else if (selectedRide.value) {
      await fetchNearbyDrivers(selectedRide.value, { quiet: true });
    }
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar las asignaciones.";
    if (!quiet) showToast(state.error, "error");
  } finally {
    state.loading = false;
  }
}

async function fetchNoResponseInvites() {
  const rides = state.rides.filter((ride) => ride.status === "pending_driver");
  const entries = await Promise.all(
    rides.map(async (ride) => {
      try {
        const query = noResponseInviteStatuses.join(",");
        const data = await apiRequest(`/api/rides/${ride.id}/driver-invites?statuses=${query}`, { method: "GET" });
        return [ride.id, data?.invites || []];
      } catch {
        return [ride.id, []];
      }
    }),
  );
  state.invitesByRideId = Object.fromEntries(entries);
}

async function fetchNearbyDrivers(ride, { quiet = false } = {}) {
  if (!ride?.id) return;
  if (!quiet) state.loadingNearby = true;
  try {
    const params = new URLSearchParams({
      radiusMeters: String(state.radiusMeters),
      limit: "12",
      excludeInvited: "false",
    });
    const data = await apiRequest(`/api/rides/${ride.id}/nearby-drivers?${params.toString()}`, { method: "GET" });
    state.nearbyDrivers = data?.drivers || [];
    updateMap();
  } catch (err) {
    state.nearbyDrivers = [];
    showToast(err?.message || "No se pudieron cargar conductores cercanos.", "error");
    updateMap();
  } finally {
    state.loadingNearby = false;
  }
}

function connectRealtime() {
  if (!auth.state.token || socket) return;
  socket = createRealtimeSocket(auth.state.token);
  socket.on("operations:ride-updated", () => fetchAssignments({ quiet: true }));
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
    await navigator.clipboard?.writeText(text);
    showToast("ID de solicitud copiado");
  } catch {
    showToast("No se pudo copiar el ID", "error");
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function formatDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value)) return "-";
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

function estimateMinutes(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value)) return "-";
  return `${Math.max(1, Math.round(value / 450))} min`;
}

function personName(person) {
  const contact = person?.contact || person;
  if (contact?.fullName) return contact.fullName;
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim();
  return name || contact?.email || "-";
}

function ridePassenger(ride) {
  return ride?.passenger || ride?.client || null;
}

function rideDriver(ride) {
  return ride?.driver || null;
}

function driverPlate(driver) {
  return driver?.vehiclePlate || driver?.vehicle?.plate || "sin placa";
}

function statusLabel(status) {
  return statusMeta[status]?.label || status || "-";
}

function statusClass(status) {
  return statusMeta[status]?.class || "border-slate-200 bg-white text-slate-600";
}

function inviteStatusSummary(ride) {
  const counts = (state.invitesByRideId[ride.id] || []).reduce((acc, invite) => {
    acc[invite.status] = (acc[invite.status] || 0) + 1;
    return acc;
  }, {});
  return noResponseInviteStatuses
    .filter((status) => counts[status])
    .map((status) => `${inviteLabels[status]}: ${counts[status]}`)
    .join(" · ") || "Sin ofertas registradas";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesSearch(ride) {
  const query = normalize(filters.search.trim());
  if (!query) return true;
  const passenger = ridePassenger(ride);
  const driver = rideDriver(ride);
  return normalize([
    ride.id,
    shortId(ride.id),
    ride.status,
    statusLabel(ride.status),
    ride.serviceType,
    ride.pickupAddress,
    ride.dropoffAddress,
    personName(passenger),
    passenger?.email,
    passenger?.phoneNumber,
    personName(driver),
    driver?.email,
    driver?.vehiclePlate,
  ].filter(Boolean).join(" ")).includes(query);
}

function matchesEventSearch(event) {
  const query = normalize(filters.search.trim());
  if (!query) return true;
  return normalize([
    event.rideId,
    shortId(event.rideId),
    event.status,
    statusLabel(event.status),
    event.actorType,
    event.actorId,
    JSON.stringify(event.payload || {}),
  ].filter(Boolean).join(" ")).includes(query);
}

function isValidLocation(location) {
  return Number.isFinite(location?.lat) && Number.isFinite(location?.lng);
}

const activeTab = computed(() => tabs.find((tab) => tab.key === filters.tab) || tabs[0]);
const assignRows = computed(() =>
  state.rides
    .filter((ride) => assignableStatuses.includes(ride.status))
    .filter(matchesSearch)
    .sort((a, b) => new Date(a.requestedAt || 0) - new Date(b.requestedAt || 0)),
);
const selectedRide = computed(() =>
  assignRows.value.find((ride) => ride.id === state.selectedRideId) || assignRows.value[0] || null
);
const otherAssignRows = computed(() => assignRows.value.filter((ride) => ride.id !== selectedRide.value?.id));
const reassignRows = computed(() =>
  state.rides
    .filter((ride) => reassignableStatuses.includes(ride.status))
    .filter(matchesSearch)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
);
const noResponseRows = computed(() =>
  state.rides
    .filter((ride) => ride.status === "pending_driver" && (state.invitesByRideId[ride.id] || []).length)
    .filter(matchesSearch)
    .sort((a, b) => new Date(a.requestedAt || 0) - new Date(b.requestedAt || 0)),
);
const historyRows = computed(() =>
  state.events
    .filter((event) => ["pending_driver", "driver_assigned"].includes(event.status))
    .filter(matchesEventSearch)
    .sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0)),
);
const currentRows = computed(() => {
  if (activeTab.value.key === "reassign") return reassignRows.value;
  if (activeTab.value.key === "no_response") return noResponseRows.value;
  if (activeTab.value.key === "history") return historyRows.value;
  return assignRows.value;
});
const summary = computed(() => [
  { label: "Por asignar", value: assignRows.value.length, icon: UserPlus },
  { label: "Reasignables", value: reassignRows.value.length, icon: Repeat2 },
  { label: "Sin respuesta", value: noResponseRows.value.length, icon: Clock3 },
  { label: "Eventos", value: historyRows.value.length, icon: History },
]);

async function selectRide(ride, { recenter = true } = {}) {
  if (!ride?.id) return;
  state.selectedRideId = ride.id;
  await fetchNearbyDrivers(ride, { quiet: !recenter });
}

async function assignRide(ride, driverId = "") {
  state.savingRideId = ride.id;
  try {
    await apiRequest(`/api/rides/${ride.id}/assign`, {
      method: "PATCH",
      body: driverId ? { driverId } : {},
    });
    showToast(driverId ? "Oferta enviada al conductor" : "Oferta enviada a conductores cercanos");
    await fetchAssignments({ quiet: true });
  } catch (err) {
    showToast(err?.message || "No se pudo asignar el servicio.", "error");
  } finally {
    state.savingRideId = "";
  }
}

async function requeueRide(ride) {
  state.savingRideId = ride.id;
  try {
    await apiRequest(`/api/rides/${ride.id}/requeue`, {
      method: "PATCH",
      body: { payload: { source: "operator_assignments_requeue" } },
    });
    showToast("Servicio devuelto a cola de asignación");
    await fetchAssignments({ quiet: true });
  } catch (err) {
    showToast(err?.message || "No se pudo reasignar el servicio.", "error");
  } finally {
    state.savingRideId = "";
  }
}

async function reofferRide(ride) {
  state.savingRideId = ride.id;
  try {
    await apiRequest(`/api/rides/${ride.id}/assign`, { method: "PATCH", body: {} });
    showToast("Servicio ofertado nuevamente");
    await fetchAssignments({ quiet: true });
  } catch (err) {
    showToast(err?.message || "No se pudo ofertar nuevamente.", "error");
  } finally {
    state.savingRideId = "";
  }
}

function initMap() {
  if (!mapEl.value || assignmentMap) return;
  const center = operationalSettings.mapCenter.value;
  assignmentMap = L.map(mapEl.value, { zoomControl: false }).setView([center.lat, center.lng], 14);
  L.control.zoom({ position: "topright" }).addTo(assignmentMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(assignmentMap);
}

function makeIcon(label, className) {
  return L.divIcon({
    className: "",
    html: `<div class="${className}">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function clearDriverMarkers() {
  driverMarkers.forEach((marker) => marker.remove());
  driverMarkers = [];
}

function destroyMap() {
  if (pickupMarker) {
    pickupMarker.remove();
    pickupMarker = null;
  }
  if (radiusCircle) {
    radiusCircle.remove();
    radiusCircle = null;
  }
  clearDriverMarkers();
  if (assignmentMap) {
    assignmentMap.remove();
    assignmentMap = null;
  }
}

function updateMap() {
  nextTick(() => {
    initMap();
    if (!assignmentMap) return;

    const ride = selectedRide.value;
    const pickup = ride?.pickupLocation;

    if (pickupMarker) {
      pickupMarker.remove();
      pickupMarker = null;
    }
    if (radiusCircle) {
      radiusCircle.remove();
      radiusCircle = null;
    }
    clearDriverMarkers();

    const bounds = [];
    if (isValidLocation(pickup)) {
      pickupMarker = L.marker([pickup.lat, pickup.lng], {
        icon: makeIcon("P", "grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-blue-600 text-xs font-bold text-white shadow"),
      })
        .addTo(assignmentMap)
        .bindTooltip(`Punto de recogida<br>${ride.pickupAddress || ""}`);
      radiusCircle = L.circle([pickup.lat, pickup.lng], {
        radius: state.radiusMeters,
        color: "#3b82f6",
        fillColor: "#3b82f6",
        fillOpacity: 0.07,
        weight: 1,
        dashArray: "4 4",
      }).addTo(assignmentMap);
      bounds.push([pickup.lat, pickup.lng]);
    }

    state.nearbyDrivers.forEach((driver, index) => {
      if (!isValidLocation(driver.currentLocation)) return;
      const marker = L.marker([driver.currentLocation.lat, driver.currentLocation.lng], {
        icon: makeIcon("C", "grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-emerald-600 text-xs font-bold text-white shadow"),
      })
        .addTo(assignmentMap)
        .bindTooltip(`${personName(driver)}<br>${formatDistance(driver.distanceMeters)} · ${driverPlate(driver)}`);
      driverMarkers.push(marker);
      if (index < 8) bounds.push([driver.currentLocation.lat, driver.currentLocation.lng]);
    });

    if (bounds.length > 1) {
      assignmentMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else if (bounds.length === 1) {
      assignmentMap.setView(bounds[0], 14);
    } else {
      const center = operationalSettings.mapCenter.value;
      assignmentMap.setView([center.lat, center.lng], 14);
    }

    assignmentMap.invalidateSize();
    window.setTimeout(() => assignmentMap?.invalidateSize(), 120);
  });
}

watch(() => route.params.assignmentView, () => {
  filters.tab = resolveRouteTab();
  if (filters.tab === "assign") updateMap();
});

watch(
  () => activeTab.value.key,
  async (tabKey, previousTabKey) => {
    if (previousTabKey === "assign" && tabKey !== "assign") {
      destroyMap();
      return;
    }

    if (tabKey === "assign") {
      await nextTick();
      updateMap();
      window.setTimeout(() => assignmentMap?.invalidateSize(), 250);
    }
  },
);

watch(() => state.radiusMeters, () => {
  if (selectedRide.value) fetchNearbyDrivers(selectedRide.value);
});

watch(selectedRide, () => updateMap());

onMounted(async () => {
  filters.tab = resolveRouteTab();
  await operationalSettings.fetchOperationalSettings();
  await fetchAssignments();
  await nextTick();
  updateMap();
  connectRealtime();
  refreshTimer = window.setInterval(() => fetchAssignments({ quiet: true }), 30000);
});

onBeforeUnmount(() => {
  socket?.disconnect();
  socket = null;
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  destroyMap();
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
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Asignaciones</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">{{ activeTab.label }}</h1>
        <p class="mt-1 text-sm text-slate-500">Selecciona la solicitud, revisa conductores cercanos y envía la oferta.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
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
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="rounded-md border border-slate-200 bg-white">
      <div class="border-b border-slate-200 p-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
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
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar solicitud, cliente, conductor o estado"
            />
          </label>
        </div>
      </div>

      <div v-if="activeTab.key === 'assign'" class="grid min-h-[680px] gap-0 xl:grid-cols-[300px_minmax(420px,1fr)_320px]">
        <aside class="border-r border-slate-200 p-3">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-950">Por asignar ({{ assignRows.length }})</h2>
            <span class="text-xs text-slate-500">{{ state.loading ? "Cargando" : "Real" }}</span>
          </div>
          <div class="grid max-h-[620px] gap-2 overflow-y-auto pr-1">
            <button
              v-for="ride in assignRows"
              :key="ride.id"
              :class="[
                'rounded-md border p-3 text-left transition hover:border-slate-300 hover:bg-slate-50',
                selectedRide?.id === ride.id ? 'border-slate-950 bg-slate-50' : 'border-slate-200 bg-white',
              ]"
              type="button"
              @click="selectRide(ride)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="font-mono text-xs font-semibold text-slate-950">#{{ shortId(ride.id) }}</div>
                <div class="text-xs text-slate-500">{{ formatTime(ride.requestedAt) }}</div>
              </div>
              <div class="mt-3 text-sm font-medium text-slate-950">{{ personName(ridePassenger(ride)) }}</div>
              <div class="mt-1 text-xs text-slate-500">{{ ridePassenger(ride)?.phoneNumber || ridePassenger(ride)?.email || "-" }}</div>
              <div class="mt-3 line-clamp-2 text-sm text-slate-700">{{ ride.pickupAddress || "-" }}</div>
              <div class="mt-3 flex items-center justify-between gap-2">
                <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{{ ride.serviceType || "-" }}</span>
                <span class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">{{ formatAge(ride.requestedAt) }}</span>
              </div>
            </button>
            <div v-if="!state.loading && !assignRows.length" class="rounded-md border border-slate-200 p-6 text-center text-sm text-slate-500">
              No hay solicitudes por asignar.
            </div>
          </div>
        </aside>

        <main class="relative min-h-[680px]">
          <div class="absolute left-4 top-4 z-[500] flex flex-wrap gap-2">
            <select v-model.number="state.radiusMeters" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm">
              <option :value="2000">Hasta 2 km</option>
              <option :value="5000">Hasta 5 km</option>
              <option :value="10000">Hasta 10 km</option>
            </select>
            <button
              class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              type="button"
              @click="selectedRide && fetchNearbyDrivers(selectedRide)"
            >
              Conductores cercanos
            </button>
          </div>
          <div ref="mapEl" class="h-full min-h-[680px] bg-slate-100"></div>
          <div class="absolute bottom-4 left-4 z-[500] rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow">
            <div class="mb-2 font-semibold text-slate-950">Leyenda</div>
            <div class="flex items-center gap-2"><span class="h-3 w-3 rounded-full bg-blue-600"></span> Punto de recogida</div>
            <div class="mt-1 flex items-center gap-2"><span class="h-3 w-3 rounded-full bg-emerald-600"></span> Conductores disponibles</div>
          </div>
        </main>

        <aside class="border-l border-slate-200 p-4">
          <template v-if="selectedRide">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold text-slate-950">Solicitud #{{ shortId(selectedRide.id) }}</h2>
                <p class="text-xs text-slate-500">{{ formatDate(selectedRide.requestedAt) }}</p>
              </div>
              <button class="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900" type="button" @click="state.selectedRideId = ''">
                <X class="h-4 w-4" />
              </button>
            </div>

            <div class="mt-4 grid gap-3 border-y border-slate-200 py-4 text-sm">
              <div>
                <div class="text-xs font-medium text-slate-500">Origen</div>
                <div class="mt-1 text-slate-950">{{ selectedRide.pickupAddress || "-" }}</div>
              </div>
              <div>
                <div class="text-xs font-medium text-slate-500">Destino</div>
                <div class="mt-1 text-slate-950">{{ selectedRide.dropoffAddress || "-" }}</div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-xs font-medium text-slate-500">Servicio</div>
                  <div class="mt-1 text-slate-950">{{ selectedRide.serviceType || "-" }}</div>
                </div>
                <div>
                  <div class="text-xs font-medium text-slate-500">Espera</div>
                  <div class="mt-1 text-slate-950">{{ formatAge(selectedRide.requestedAt) }}</div>
                </div>
              </div>
            </div>

            <div class="mt-4 flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-slate-950">Conductores sugeridos</h3>
              <span class="text-xs text-slate-500">{{ state.loadingNearby ? "Cargando..." : `${state.nearbyDrivers.length} disponibles` }}</span>
            </div>
            <div class="mt-3 grid max-h-[330px] gap-2 overflow-y-auto pr-1">
              <div v-for="driver in state.nearbyDrivers" :key="driver.userId" class="rounded-md border border-slate-200 p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="font-medium text-slate-950">{{ personName(driver) }}</div>
                    <div class="text-xs text-slate-500">{{ estimateMinutes(driver.distanceMeters) }} · {{ formatDistance(driver.distanceMeters) }} · {{ driverPlate(driver) }}</div>
                    <div class="mt-1 text-xs text-emerald-700">Disponible</div>
                  </div>
                  <button
                    class="h-8 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    :disabled="state.savingRideId === selectedRide.id"
                    type="button"
                    @click="assignRide(selectedRide, driver.userId)"
                  >
                    Asignar
                  </button>
                </div>
              </div>
              <div v-if="!state.loadingNearby && !state.nearbyDrivers.length" class="rounded-md border border-slate-200 p-4 text-sm text-slate-500">
                No hay conductores elegibles en el radio seleccionado.
              </div>
            </div>

            <button
              class="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              :disabled="state.savingRideId === selectedRide.id"
              type="button"
              @click="assignRide(selectedRide)"
            >
              <Send class="h-4 w-4" />
              Auto-asignación
            </button>
          </template>
          <div v-else class="rounded-md border border-slate-200 p-6 text-center text-sm text-slate-500">
            Selecciona una solicitud para ver conductores cercanos.
          </div>
        </aside>
      </div>

      <div v-else-if="activeTab.key !== 'history'" class="overflow-auto">
        <table class="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Solicitud</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Cliente</th>
              <th class="py-2 pr-3">Conductor</th>
              <th class="py-2 pr-3">Origen</th>
              <th class="py-2 pr-3">Servicio</th>
              <th class="py-2 pr-4">Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ride in currentRows" :key="ride.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs font-medium text-slate-950">#{{ shortId(ride.id) }}</span>
                  <button class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900" type="button" @click="copyText(ride.id)">
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
                <div class="mt-1 text-xs text-slate-500">{{ formatDate(ride.requestedAt) }}</div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', statusClass(ride.status)]">{{ statusLabel(ride.status) }}</span>
                <div v-if="activeTab.key === 'no_response'" class="mt-1 text-xs text-slate-500">{{ inviteStatusSummary(ride) }}</div>
              </td>
              <td class="py-3 pr-3">{{ personName(ridePassenger(ride)) }}</td>
              <td class="py-3 pr-3">{{ rideDriver(ride) ? personName(rideDriver(ride)) : "Sin asignar" }}</td>
              <td class="max-w-[300px] truncate py-3 pr-3" :title="ride.pickupAddress">{{ ride.pickupAddress || "-" }}</td>
              <td class="py-3 pr-3">{{ ride.serviceType || "-" }}</td>
              <td class="py-3 pr-4">
                <button
                  v-if="activeTab.key === 'reassign'"
                  class="inline-flex h-9 items-center gap-1 rounded-md bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  :disabled="state.savingRideId === ride.id"
                  type="button"
                  @click="requeueRide(ride)"
                >
                  <Repeat2 class="h-3.5 w-3.5" />
                  Reasignar
                </button>
                <button
                  v-else
                  class="inline-flex h-9 items-center gap-1 rounded-md bg-slate-950 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  :disabled="state.savingRideId === ride.id"
                  type="button"
                  @click="reofferRide(ride)"
                >
                  <Send class="h-3.5 w-3.5" />
                  Reofertar
                </button>
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
        <table class="w-full min-w-[900px] border-collapse text-sm">
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
                  <button class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900" type="button" @click="copyText(event.rideId)">
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', statusClass(event.status)]">{{ statusLabel(event.status) }}</span>
              </td>
              <td class="py-3 pr-3">{{ event.actorType || "-" }}</td>
              <td class="py-3 pr-4 text-xs text-slate-600">{{ event.payload ? JSON.stringify(event.payload) : "-" }}</td>
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
