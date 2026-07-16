<script setup>
import { computed, onMounted, reactive } from "vue";
import { RefreshCw, Search, Star, TrendingUp, UserCheck } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const state = reactive({
  loading: true,
  error: "",
  drivers: [],
  rides: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
  rating: "all",
});

async function fetchRatings() {
  state.loading = true;
  state.error = "";

  try {
    const [driversData, ridesData] = await Promise.all([
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
      apiRequest("/api/rides?limit=500", { method: "GET" }),
    ]);
    state.drivers = driversData?.drivers || [];
    state.rides = ridesData?.rides || [];
    state.lastUpdatedAt = driversData?.server?.now || new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar las calificaciones.";
  } finally {
    state.loading = false;
  }
}

function driverName(driver) {
  const name = [driver?.contact?.firstName, driver?.contact?.lastName].filter(Boolean).join(" ").trim();
  return name || driver?.contact?.email || shortId(driver?.userId);
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

function formatRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating.toFixed(2) : "Sin calificación";
}

function ratingTone(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return "border-slate-200 bg-slate-50 text-slate-600";
  if (rating >= 4.5) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (rating >= 3.5) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

const completedByDriverId = computed(() => {
  const map = new Map();
  for (const ride of state.rides) {
    if (!ride.driverId || ride.status !== "completed") continue;
    map.set(ride.driverId, (map.get(ride.driverId) || 0) + 1);
  }
  return map;
});

const filteredDrivers = computed(() => {
  const query = filters.search.trim().toLowerCase();

  return state.drivers.filter((driver) => {
    const rating = Number(driver.rating || 0);
    if (filters.rating === "high" && rating < 4.5) return false;
    if (filters.rating === "medium" && (rating < 3.5 || rating >= 4.5)) return false;
    if (filters.rating === "low" && (!rating || rating >= 3.5)) return false;
    if (filters.rating === "unrated" && rating > 0) return false;
    if (!query) return true;

    return [
      driver.userId,
      driverName(driver),
      driver.contact?.email,
      driver.vehicle?.plate,
      driver.vehicle?.model,
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
});

const averageRating = computed(() => {
  const ratings = state.drivers.map((driver) => Number(driver.rating)).filter((rating) => Number.isFinite(rating) && rating > 0);
  if (!ratings.length) return null;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
});

const summary = computed(() => [
  { label: "Conductores", value: state.drivers.length, icon: UserCheck },
  { label: "Promedio", value: averageRating.value ? averageRating.value.toFixed(2) : "-", icon: Star },
  { label: ">= 4.5", value: state.drivers.filter((driver) => Number(driver.rating) >= 4.5).length, icon: TrendingUp },
  { label: "Sin calificación", value: state.drivers.filter((driver) => !Number(driver.rating)).length, icon: Star },
]);

onMounted(fetchRatings);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Conductores</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Calificaciones</h1>
        <p class="mt-1 text-sm text-slate-500">Puntaje acumulado y servicios finalizados por conductor.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchRatings"
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

    <div class="rounded-md border border-slate-200 bg-white p-4">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Ranking</h2>
          <p class="text-sm text-slate-500">
            {{ filteredDrivers.length }} visibles
            <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar conductor, placa o correo"
            />
          </label>
          <select
            v-model="filters.rating"
            class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="all">Todas</option>
            <option value="high">Altas (>= 4.5)</option>
            <option value="medium">Medias (3.5 - 4.49)</option>
            <option value="low">Bajas (&lt; 3.5)</option>
            <option value="unrated">Sin calificación</option>
          </select>
        </div>
      </div>

      <div class="overflow-auto">
        <table class="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Conductor</th>
              <th class="py-2 pr-3">Calificación</th>
              <th class="py-2 pr-3">Finalizados</th>
              <th class="py-2 pr-3">Vehículo</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Servicios</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="driver in filteredDrivers"
              :key="driver.userId"
              class="border-b border-slate-100 text-slate-700"
            >
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ driverName(driver) }}</div>
                <div class="text-xs text-slate-500">{{ driver.contact?.email || shortId(driver.userId) }}</div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold', ratingTone(driver.rating)]">
                  <Star class="h-3.5 w-3.5" />
                  {{ formatRating(driver.rating) }}
                </span>
              </td>
              <td class="py-3 pr-3">{{ completedByDriverId.get(driver.userId) || 0 }}</td>
              <td class="py-3 pr-3">
                <div>{{ [driver.vehicle?.make, driver.vehicle?.model].filter(Boolean).join(" ") || "-" }}</div>
                <div class="font-mono text-xs text-slate-500">{{ driver.vehicle?.plate || "-" }}</div>
              </td>
              <td class="py-3 pr-3">{{ driver.status || "-" }}</td>
              <td class="py-3 pr-3">{{ driver.serviceTypes?.length ? driver.serviceTypes.join(", ") : "-" }}</td>
            </tr>
            <tr v-if="!state.loading && filteredDrivers.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="6">No hay calificaciones para los filtros actuales.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="6">Cargando calificaciones...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
