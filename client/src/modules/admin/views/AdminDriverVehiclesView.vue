<script setup>
import { computed, onMounted, reactive } from "vue";
import { Car, CircleGauge, Palette, RefreshCw, Search } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const state = reactive({
  loading: true,
  error: "",
  drivers: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
  type: "all",
});

async function fetchVehicles() {
  state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/admin/drivers-map", { method: "GET" });
    state.drivers = data?.drivers || [];
    state.lastUpdatedAt = data?.server?.now || new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar los vehículos.";
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

function vehicleLabel(vehicle) {
  return [vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "-";
}

const vehicleTypes = computed(() => {
  const values = new Set(state.drivers.map((driver) => driver.vehicle?.type).filter(Boolean));
  return Array.from(values).sort((a, b) => a.localeCompare(b));
});

const filteredDrivers = computed(() => {
  const query = filters.search.trim().toLowerCase();

  return state.drivers.filter((driver) => {
    if (filters.type !== "all" && driver.vehicle?.type !== filters.type) return false;
    if (!query) return true;

    return [
      driver.userId,
      driverName(driver),
      driver.contact?.email,
      driver.vehicle?.plate,
      driver.vehicle?.make,
      driver.vehicle?.model,
      driver.vehicle?.year,
      driver.vehicle?.color,
      driver.vehicle?.type,
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
});

const summary = computed(() => {
  const total = state.drivers.length;
  const withPlate = state.drivers.filter((driver) => driver.vehicle?.plate).length;
  const active = state.drivers.filter((driver) => ["online", "busy"].includes(driver.status)).length;
  const types = vehicleTypes.value.length;

  return [
    { label: "Vehículos", value: total, icon: Car },
    { label: "Con placa", value: withPlate, icon: CircleGauge },
    { label: "Activos", value: active, icon: Car },
    { label: "Tipos", value: types, icon: Palette },
  ];
});

onMounted(fetchVehicles);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Conductores</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Vehículos</h1>
        <p class="mt-1 text-sm text-slate-500">Inventario de vehículos registrados por conductor.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchVehicles"
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
          <h2 class="text-base font-semibold text-slate-950">Vehículos</h2>
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
              placeholder="Buscar placa, modelo o conductor"
            />
          </label>
          <select
            v-model="filters.type"
            class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="all">Todos los tipos</option>
            <option v-for="type in vehicleTypes" :key="type" :value="type">{{ type }}</option>
          </select>
        </div>
      </div>

      <div class="overflow-auto">
        <table class="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Placa</th>
              <th class="py-2 pr-3">Vehículo</th>
              <th class="py-2 pr-3">Color</th>
              <th class="py-2 pr-3">Tipo</th>
              <th class="py-2 pr-3">Conductor</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Servicios</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="driver in filteredDrivers" :key="driver.userId" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pr-3 font-mono text-xs font-semibold text-slate-950">{{ driver.vehicle?.plate || "-" }}</td>
              <td class="py-3 pr-3">{{ vehicleLabel(driver.vehicle) }}</td>
              <td class="py-3 pr-3">{{ driver.vehicle?.color || "-" }}</td>
              <td class="py-3 pr-3">{{ driver.vehicle?.type || "-" }}</td>
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ driverName(driver) }}</div>
                <div class="text-xs text-slate-500">{{ driver.contact?.email || shortId(driver.userId) }}</div>
              </td>
              <td class="py-3 pr-3">
                <span class="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{{ driver.status || "-" }}</span>
              </td>
              <td class="py-3 pr-3">{{ driver.serviceTypes?.length ? driver.serviceTypes.join(", ") : "-" }}</td>
            </tr>
            <tr v-if="!state.loading && filteredDrivers.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="7">No hay vehículos para los filtros actuales.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="7">Cargando vehículos...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
