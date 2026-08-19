<script setup>
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Car, CheckCircle2, Clock, MapPin, Navigation, Phone, RotateCw } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { io } from "socket.io-client";

import { apiRequest, buildApiUrl } from "../../../services/api.js";

const route = useRoute();
const trackingToken = computed(() => String(route.params.token || ""));

const ride = ref(null);
const loading = ref(true);
const refreshing = ref(false);
const error = ref("");
const realtimeState = ref("connecting");
const mapEl = ref(null);

let socket = null;
let map = null;
let driverMarker = null;
let pickupMarker = null;
let dropoffMarker = null;
let pollingTimer = null;

const steps = [
  { key: "requested", label: "Solicitado" },
  { key: "driver_assigned", label: "Asignado" },
  { key: "driver_en_route", label: "En camino" },
  { key: "driver_arrived", label: "Llegó" },
  { key: "in_progress", label: "En viaje" },
  { key: "completed", label: "Finalizado" },
];

const statusLabels = {
  requested: "Buscando conductor",
  pending_driver: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  driver_en_route: "El conductor va en camino",
  driver_arrived: "El conductor llegó",
  in_progress: "Viaje en curso",
  completed: "Viaje finalizado",
  canceled_by_client: "Viaje cancelado",
  canceled_by_driver: "Viaje cancelado",
  canceled_by_system: "Viaje cancelado",
  no_show: "No presentado",
};

const terminalStatuses = new Set([
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
]);

const activeStepIndex = computed(() => {
  const status = ride.value?.status;
  if (status === "pending_driver") return 0;
  const index = steps.findIndex((step) => step.key === status);
  return index >= 0 ? index : 0;
});

const statusLabel = computed(() => statusLabels[ride.value?.status] || "Actualizando viaje");
const hasDriver = computed(() => Boolean(ride.value?.driver));
const driverLocation = computed(
  () => ride.value?.driverLocation || ride.value?.driver?.currentLocation || null
);
const vehicleLabel = computed(() => {
  const driver = ride.value?.driver;
  if (!driver) return "";
  return [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(" ");
});
const etaLabel = computed(() => {
  const seconds = ride.value?.estimatedDurationSeconds;
  if (!seconds) return "ETA por confirmar";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min aprox.`;
});

async function fetchRide({ silent = false } = {}) {
  if (!trackingToken.value) return;
  if (silent) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  error.value = "";

  try {
    const data = await apiRequest(`/api/rides/public/${trackingToken.value}`);
    ride.value = data.ride;
    connectRealtime(data.realtime?.token);
    await nextTick();
    updateMap();
  } catch (fetchError) {
    error.value = fetchError.message || "No pudimos cargar el seguimiento.";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function connectRealtime(token) {
  if (!token || socket?.connected) return;
  socket?.disconnect();

  socket = io(buildApiUrl("") || undefined, {
    path: import.meta.env.VITE_SOCKET_PATH || "/socket.io",
    transports: ["websocket", "polling"],
    auth: { token },
  });

  socket.on("connect", () => {
    realtimeState.value = "connected";
    socket.emit("ride:public-subscribe", { rideId: ride.value?.id });
  });

  socket.on("disconnect", () => {
    realtimeState.value = "disconnected";
  });

  socket.on("connect_error", () => {
    realtimeState.value = "polling";
  });

  socket.on("ride:status-updated", (payload) => {
    if (payload?.ride?.id !== ride.value?.id) return;
    fetchRide({ silent: true });
  });

  socket.on("ride:driver-location-updated", (payload) => {
    if (payload?.rideId !== ride.value?.id || !ride.value) return;
    ride.value = {
      ...ride.value,
      driverLocation: payload.currentLocation,
      driver: ride.value.driver
        ? {
            ...ride.value.driver,
            currentLocation: payload.currentLocation,
            headingDegrees: payload.headingDegrees,
            speedKmh: payload.speedKmh,
          }
        : ride.value.driver,
    };
    updateMap();
  });
}

function createMarker(location, label, color) {
  if (!Number.isFinite(Number(location?.lat)) || !Number.isFinite(Number(location?.lng))) {
    return null;
  }
  return L.circleMarker([location.lat, location.lng], {
    radius: 8,
    weight: 3,
    color,
    fillColor: color,
    fillOpacity: 0.9,
  }).bindTooltip(label);
}

function updateMap() {
  if (!mapEl.value || !ride.value) return;

  const points = [
    ride.value.pickupLocation,
    ride.value.dropoffLocation,
    driverLocation.value,
  ].filter((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)));

  if (!points.length) return;

  if (!map) {
    map = L.map(mapEl.value, { zoomControl: false, attributionControl: false }).setView(
      [points[0].lat, points[0].lng],
      14
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
  }

  pickupMarker?.remove();
  dropoffMarker?.remove();
  driverMarker?.remove();

  pickupMarker = createMarker(ride.value.pickupLocation, "Origen", "#111827");
  dropoffMarker = createMarker(ride.value.dropoffLocation, "Destino", "#2563eb");
  driverMarker = createMarker(driverLocation.value, "Conductor", "#16a34a");

  [pickupMarker, dropoffMarker, driverMarker].filter(Boolean).forEach((marker) => marker.addTo(map));

  const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
}

onMounted(() => {
  fetchRide();
  pollingTimer = window.setInterval(() => {
    if (!terminalStatuses.has(ride.value?.status)) {
      fetchRide({ silent: true });
    }
  }, 30000);
});

watch(driverLocation, updateMap);

onBeforeUnmount(() => {
  if (pollingTimer) window.clearInterval(pollingTimer);
  socket?.disconnect();
  map?.remove();
});
</script>

<template>
  <section class="tracking-screen">
    <div class="tracking-topbar">
      <div class="brand-lockup">
        <img src="../../../assets/images/logo/logo.png" alt="Taxi" />
        <span>Seguimiento</span>
      </div>
      <button class="icon-button" :disabled="refreshing" @click="fetchRide({ silent: true })">
        <RotateCw :size="18" />
      </button>
    </div>

    <div v-if="loading" class="tracking-state">
      <Clock :size="28" />
      <p>Cargando viaje...</p>
    </div>

    <div v-else-if="error" class="tracking-state">
      <MapPin :size="28" />
      <p>{{ error }}</p>
    </div>

    <template v-else>
      <header class="trip-hero">
        <p>{{ etaLabel }}</p>
        <h1>{{ statusLabel }}</h1>
        <span :class="['connection-pill', realtimeState]">
          {{ realtimeState === "connected" ? "En vivo" : "Actualizando" }}
        </span>
      </header>

      <div class="map-panel">
        <div ref="mapEl" class="tracking-map"></div>
      </div>

      <section class="driver-panel">
        <div class="driver-icon">
          <Car :size="24" />
        </div>
        <div>
          <p>{{ hasDriver ? ride.driver.fullName || ride.driver.firstName : "Conductor por asignar" }}</p>
          <span v-if="hasDriver">{{ vehicleLabel || "Vehículo por confirmar" }}</span>
          <strong v-if="hasDriver && ride.driver.vehiclePlate">{{ ride.driver.vehiclePlate }}</strong>
        </div>
        <button class="call-button" aria-label="Contactar soporte">
          <Phone :size="18" />
        </button>
      </section>

      <section class="route-panel">
        <div>
          <MapPin :size="18" />
          <p>{{ ride.pickupAddress || "Origen por confirmar" }}</p>
        </div>
        <div v-if="ride.hasDestination">
          <Navigation :size="18" />
          <p>{{ ride.dropoffAddress || "Destino por confirmar" }}</p>
        </div>
      </section>

      <ol class="progress-list">
        <li
          v-for="(step, index) in steps"
          :key="step.key"
          :class="{ done: index <= activeStepIndex }"
        >
          <CheckCircle2 :size="18" />
          <span>{{ step.label }}</span>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.tracking-screen {
  min-height: 100vh;
  padding: 18px;
  background: #f5f5f0;
  color: #171717;
}

.tracking-topbar,
.driver-panel,
.route-panel div {
  display: flex;
  align-items: center;
}

.tracking-topbar {
  justify-content: space-between;
  margin-bottom: 18px;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 800;
}

.brand-lockup img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.icon-button,
.call-button {
  display: grid;
  place-items: center;
  border: 1px solid #d7d5ca;
  background: #ffffff;
  color: #171717;
}

.icon-button {
  width: 38px;
  height: 38px;
  border-radius: 8px;
}

.trip-hero {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.trip-hero p {
  margin: 0;
  color: #5f625b;
  font-size: 14px;
  font-weight: 700;
}

.trip-hero h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.05;
}

.connection-pill {
  width: max-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: #ece9dc;
  color: #565950;
  font-size: 12px;
  font-weight: 800;
}

.connection-pill.connected {
  background: #dff4d7;
  color: #1d5c29;
}

.map-panel {
  height: 260px;
  overflow: hidden;
  border: 1px solid #d8d5c8;
  border-radius: 8px;
  background: #e5e1d4;
}

.tracking-map {
  width: 100%;
  height: 100%;
}

.driver-panel,
.route-panel,
.progress-list {
  margin-top: 12px;
  border: 1px solid #d8d5c8;
  border-radius: 8px;
  background: #ffffff;
}

.driver-panel {
  gap: 12px;
  padding: 14px;
}

.driver-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: #171717;
  color: #ffffff;
  flex: 0 0 auto;
}

.driver-panel p,
.route-panel p {
  margin: 0;
  font-weight: 800;
}

.driver-panel span,
.driver-panel strong {
  display: block;
  margin-top: 3px;
  color: #5f625b;
  font-size: 13px;
}

.driver-panel strong {
  color: #171717;
  letter-spacing: 0;
}

.call-button {
  width: 38px;
  height: 38px;
  margin-left: auto;
  border-radius: 8px;
}

.route-panel {
  display: grid;
  gap: 1px;
  overflow: hidden;
}

.route-panel div {
  gap: 10px;
  padding: 13px 14px;
  background: #ffffff;
}

.route-panel svg {
  flex: 0 0 auto;
  color: #4d514a;
}

.progress-list {
  display: grid;
  gap: 0;
  padding: 8px 14px;
  list-style: none;
}

.progress-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  color: #8a8b84;
  font-size: 14px;
  font-weight: 800;
}

.progress-list li.done {
  color: #171717;
}

.progress-list li.done svg {
  color: #16a34a;
}

.tracking-state {
  min-height: 70vh;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #4b4e48;
  text-align: center;
  font-weight: 800;
}

@media (min-width: 720px) {
  .tracking-screen {
    max-width: 480px;
    margin: 0 auto;
  }
}
</style>
