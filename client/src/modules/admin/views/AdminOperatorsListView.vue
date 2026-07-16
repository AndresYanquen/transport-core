<script setup>
import { computed, onMounted, reactive } from "vue";
import { Clock3, Headset, RefreshCw, Search, ShieldCheck, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const shiftLabels = {
  morning: "Mañana",
  afternoon: "Tarde",
  night: "Noche",
};

const specialtyLabels = {
  ride_dispatch: "Despacho",
  customer_support: "Clientes",
  driver_support: "Conductores",
  incident_management: "Incidentes",
};

const state = reactive({
  loading: true,
  error: "",
  operators: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
  status: "all",
  shift: "all",
});

async function fetchOperators() {
  state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/admin/users?role=operator&limit=200", { method: "GET" });
    state.operators = data?.users || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar las operadoras.";
  } finally {
    state.loading = false;
  }
}

function operatorName(operator) {
  const name = [operator.firstName, operator.lastName].filter(Boolean).join(" ").trim();
  return name || operator.email || shortId(operator.id);
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

function shiftLabel(value) {
  return shiftLabels[value] || value || "Sin turno";
}

function specialtyLabel(value) {
  return specialtyLabels[value] || value;
}

function statusClass(status) {
  return status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : status === "suspended"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
}

const filteredOperators = computed(() => {
  const query = filters.search.trim().toLowerCase();

  return state.operators.filter((operator) => {
    const profile = operator.operatorProfile || {};
    if (filters.status !== "all" && operator.status !== filters.status) return false;
    if (filters.shift !== "all" && profile.shift !== filters.shift) return false;
    if (!query) return true;

    return [
      operator.email,
      operator.username,
      operator.firstName,
      operator.lastName,
      operator.phoneNumber,
      profile.employeeCode,
      profile.operationZone,
      profile.shift,
      ...(profile.specialties || []),
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
});

const summary = computed(() => {
  const active = state.operators.filter((operator) => operator.status === "active").length;
  const withShift = state.operators.filter((operator) => operator.operatorProfile?.shift).length;
  const zones = new Set(state.operators.map((operator) => operator.operatorProfile?.operationZone).filter(Boolean)).size;

  return [
    { label: "Operadoras", value: state.operators.length, icon: Headset },
    { label: "Activas", value: active, icon: Users },
    { label: "Con turno base", value: withShift, icon: Clock3 },
    { label: "Zonas asignadas", value: zones, icon: ShieldCheck },
  ];
});

onMounted(fetchOperators);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Operadoras</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Listado</h1>
        <p class="mt-1 text-sm text-slate-500">Operadoras registradas desde usuarios reales con rol operadora.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchOperators"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 md:grid-cols-4">
      <article v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
          </div>
          <span class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="item.icon" class="h-4 w-4" />
          </span>
        </div>
      </article>
    </div>

    <section class="rounded-md border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Operadoras</h2>
          <p class="mt-1 text-sm text-slate-500">{{ filteredOperators.length }} registros visibles</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-72 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
              placeholder="Buscar operadora, zona o código"
              type="search"
            />
          </label>
          <select v-model="filters.status" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="all">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="inactive">Inactivas</option>
            <option value="suspended">Suspendidas</option>
          </select>
          <select v-model="filters.shift" class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
            <option value="all">Todos los turnos</option>
            <option value="morning">Mañana</option>
            <option value="afternoon">Tarde</option>
            <option value="night">Noche</option>
          </select>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[980px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Operadora</th>
              <th class="px-4 py-3">Código</th>
              <th class="px-4 py-3">Turno base</th>
              <th class="px-4 py-3">Zona</th>
              <th class="px-4 py-3">Especialidades</th>
              <th class="px-4 py-3">Estado</th>
              <th class="px-4 py-3">Último acceso</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="operator in filteredOperators" :key="operator.id" class="border-b border-slate-100 hover:bg-slate-50">
              <td class="px-4 py-3">
                <div class="font-medium text-slate-950">{{ operatorName(operator) }}</div>
                <div class="text-xs text-slate-500">{{ operator.email }}</div>
                <div class="text-xs text-slate-400">{{ operator.phoneNumber || "Sin teléfono" }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-slate-700">{{ operator.operatorProfile?.employeeCode || "-" }}</td>
              <td class="px-4 py-3">{{ shiftLabel(operator.operatorProfile?.shift) }}</td>
              <td class="px-4 py-3">{{ operator.operatorProfile?.operationZone || "-" }}</td>
              <td class="px-4 py-3">
                <div class="flex max-w-md flex-wrap gap-1">
                  <span
                    v-for="specialty in operator.operatorProfile?.specialties || []"
                    :key="specialty"
                    class="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                  >
                    {{ specialtyLabel(specialty) }}
                  </span>
                  <span v-if="!operator.operatorProfile?.specialties?.length" class="text-slate-400">-</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <span :class="['inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', statusClass(operator.status)]">
                  {{ operator.status || "-" }}
                </span>
              </td>
              <td class="px-4 py-3 text-slate-600">{{ formatDate(operator.lastLoginAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!state.loading && !filteredOperators.length" class="py-10 text-center text-sm text-slate-500">
        No hay operadoras para los filtros seleccionados.
      </div>
    </section>

    <footer class="text-xs text-slate-500">
      Actualizado: {{ formatDate(state.lastUpdatedAt) }}
    </footer>
  </section>
</template>
