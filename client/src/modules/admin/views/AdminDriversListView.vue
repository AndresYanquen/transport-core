<script setup>
import { computed, onMounted, reactive } from "vue";
import { Car, MapPin, RefreshCw, Search, UserCheck } from "lucide-vue-next";
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
  status: "all",
  simOnly: false,
});

async function fetchDrivers() {
  state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/admin/simulation/state?limit=300", {
      method: "GET",
    });
    state.drivers = data?.drivers || [];
    state.rides = data?.rides || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar conductores.";
  } finally {
    state.loading = false;
  }
}

function shortId(id) {
  if (!id) return "-";
  const s = String(id);
  return s.length > 12 ? `${s.slice(0, 8)}...${s.slice(-4)}` : s;
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

function statusLabel(status) {
  const labels = {
    online: "Online",
    busy: "Ocupado",
    unavailable: "No disponible",
    offline: "Offline",
  };
  return labels[status] || status || "-";
}

function statusClass(status) {
  if (status === "online") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "busy") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "offline") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

const ridesByDriverId = computed(() => {
  const map = new Map();
  for (const ride of state.rides) {
    if (!ride.driverId) continue;
    if (!map.has(ride.driverId)) map.set(ride.driverId, []);
    map.get(ride.driverId).push(ride);
  }
  return map;
});

const filteredDrivers = computed(() => {
  const q = filters.search.trim().toLowerCase();

  return state.drivers.filter((driver) => {
    if (filters.status !== "all" && driver.status !== filters.status) return false;
    if (filters.simOnly && !driver.isSimUser) return false;
    if (!q) return true;

    return (
      String(driver.userId || "").toLowerCase().includes(q) ||
      String(driver.contact?.email || "").toLowerCase().includes(q) ||
      String(driver.contact?.firstName || "").toLowerCase().includes(q) ||
      String(driver.contact?.lastName || "").toLowerCase().includes(q)
    );
  });
});

const summary = computed(() => {
  const total = state.drivers.length;
  const online = state.drivers.filter((driver) => driver.status === "online").length;
  const busy = state.drivers.filter((driver) => driver.status === "busy" || driver.currentRideId).length;
  const offline = state.drivers.filter((driver) => driver.status === "offline").length;

  return [
    { label: "Total", value: total },
    { label: "Online", value: online },
    { label: "Ocupados", value: busy },
    { label: "Offline", value: offline },
  ];
});

onMounted(fetchDrivers);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Conductores</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Listado</h1>
        <p class="mt-1 text-sm text-slate-500">Estado operativo, ubicación y servicio actual.</p>
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
            <UserCheck v-if="item.label === 'Online'" class="h-4 w-4" />
            <Car v-else class="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white p-4">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Conductores</h2>
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
              class="h-9 w-72 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar nombre, email o ID"
            />
          </label>
          <select
            v-model="filters.status"
            class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="all">Todos</option>
            <option value="online">Online</option>
            <option value="busy">Ocupados</option>
            <option value="unavailable">No disponibles</option>
            <option value="offline">Offline</option>
          </select>
          <label class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700">
            <input v-model="filters.simOnly" class="h-4 w-4" type="checkbox" />
            Simulados
          </label>
        </div>
      </div>

      <div class="overflow-auto">
        <table class="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Conductor</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Servicio actual</th>
              <th class="py-2 pr-3">Servicios en ventana</th>
              <th class="py-2 pr-3">Ubicación</th>
              <th class="py-2 pr-3">Última actualización</th>
              <th class="py-2 pr-3">Tipo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="driver in filteredDrivers" :key="driver.userId" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ driverName(driver) }}</div>
                <div class="font-mono text-xs text-slate-500">{{ shortId(driver.userId) }}</div>
                <div class="text-xs text-slate-500">{{ driver.contact?.email || "-" }}</div>
              </td>
              <td class="py-3 pr-3">
                <span :class="['inline-flex rounded-md border px-2 py-1 text-xs font-medium', statusClass(driver.status)]">
                  {{ statusLabel(driver.status) }}
                </span>
              </td>
              <td class="py-3 pr-3 font-mono text-xs">
                {{ driver.currentRideId ? shortId(driver.currentRideId) : "-" }}
              </td>
              <td class="py-3 pr-3">
                {{ ridesByDriverId.get(driver.userId)?.length || 0 }}
              </td>
              <td class="py-3 pr-3">
                <div v-if="driver.currentLocation" class="inline-flex items-center gap-1 font-mono text-xs text-slate-600">
                  <MapPin class="h-3.5 w-3.5" />
                  {{ Number(driver.currentLocation.lat).toFixed(5) }},
                  {{ Number(driver.currentLocation.lng).toFixed(5) }}
                </div>
                <span v-else class="text-slate-400">Sin ubicación</span>
              </td>
              <td class="py-3 pr-3">{{ formatDate(driver.updatedAt) }}</td>
              <td class="py-3 pr-3">
                <span v-if="driver.isSimUser" class="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">Simulado</span>
                <span v-else class="text-slate-400">Real</span>
              </td>
            </tr>
            <tr v-if="!state.loading && filteredDrivers.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="7">No hay conductores para los filtros actuales.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="7">Cargando conductores...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
