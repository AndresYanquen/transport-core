<script setup>
import { computed, onMounted, reactive } from "vue";
import { Ban, RefreshCw, Search, ShieldAlert, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const state = reactive({ loading: true, error: "", users: [], rides: [], lastUpdatedAt: null });
const filters = reactive({ search: "", type: "all" });

async function fetchBlocks() {
  state.loading = true;
  state.error = "";
  try {
    const [usersData, ridesData] = await Promise.all([
      apiRequest("/api/admin/users?role=client&limit=200", { method: "GET" }),
      apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" }),
    ]);
    state.users = usersData?.users || [];
    state.rides = ridesData?.rides || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar los bloqueos.";
  } finally {
    state.loading = false;
  }
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function customerName(user) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.email || shortId(user?.id);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

const rideStatsByClientId = computed(() => {
  const map = new Map();
  for (const ride of state.rides) {
    if (!ride.clientId) continue;
    const current = map.get(ride.clientId) || { total: 0, canceled: 0, noShow: 0, lastAt: null };
    current.total += 1;
    if (String(ride.status || "").startsWith("canceled")) current.canceled += 1;
    if (ride.status === "no_show") current.noShow += 1;
    if (!current.lastAt || new Date(ride.requestedAt || 0) > new Date(current.lastAt || 0)) current.lastAt = ride.requestedAt;
    map.set(ride.clientId, current);
  }
  return map;
});

const blockRows = computed(() =>
  state.users.map((user) => {
    const stats = rideStatsByClientId.value.get(user.id) || { total: 0, canceled: 0, noShow: 0, lastAt: null };
    const blocked = ["suspended", "inactive"].includes(user.status);
    const risk = stats.canceled >= 3 || stats.noShow >= 2;
    return {
      user,
      stats,
      blocked,
      risk,
      type: blocked ? "Bloqueado" : risk ? "Riesgo operativo" : "Normal",
      reason: blocked ? `Estado de cuenta: ${user.status}` : risk ? `${stats.canceled} cancelaciones, ${stats.noShow} no show` : "Sin señales de bloqueo",
    };
  }),
);

const filteredRows = computed(() => {
  const query = filters.search.trim().toLowerCase();
  return blockRows.value.filter((row) => {
    if (filters.type === "blocked" && !row.blocked) return false;
    if (filters.type === "risk" && !row.risk) return false;
    if (filters.type === "normal" && (row.blocked || row.risk)) return false;
    if (!query) return true;
    return [row.user.id, customerName(row.user), row.user.email, row.user.phoneNumber, row.reason].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
});

const summary = computed(() => [
  { label: "Clientes", value: state.users.length, icon: Users },
  { label: "Bloqueados", value: blockRows.value.filter((row) => row.blocked).length, icon: Ban },
  { label: "Riesgo", value: blockRows.value.filter((row) => row.risk && !row.blocked).length, icon: ShieldAlert },
  { label: "Normales", value: blockRows.value.filter((row) => !row.risk && !row.blocked).length, icon: Users },
]);

onMounted(fetchBlocks);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Clientes</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Bloqueos</h1>
        <p class="mt-1 text-sm text-slate-500">Estados de cuenta y señales operativas para revisión.</p>
      </div>
      <button class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60" :disabled="state.loading" type="button" @click="fetchBlocks"><RefreshCw class="h-4 w-4" />Actualizar</button>
    </div>
    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{{ state.error }}</div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3"><div><div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div><div class="mt-1 text-sm text-slate-500">{{ item.label }}</div></div><div class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white"><component :is="item.icon" class="h-4 w-4" /></div></div>
      </div>
    </div>
    <div class="rounded-md border border-slate-200 bg-white p-4">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 class="text-base font-semibold text-slate-950">Revisión de clientes</h2><p class="text-sm text-slate-500">{{ filteredRows.length }} visibles <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span></p></div>
        <div class="flex flex-wrap gap-2">
          <label class="relative"><Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input v-model.trim="filters.search" class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" placeholder="Buscar cliente, correo o razón" /></label>
          <select v-model="filters.type" class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"><option value="all">Todos</option><option value="blocked">Bloqueados</option><option value="risk">Riesgo operativo</option><option value="normal">Normales</option></select>
        </div>
      </div>
      <div class="overflow-auto">
        <table class="w-full min-w-[920px] border-collapse text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><th class="py-2 pr-3">Cliente</th><th class="py-2 pr-3">Tipo</th><th class="py-2 pr-3">Razón</th><th class="py-2 pr-3">Cancelaciones</th><th class="py-2 pr-3">No show</th><th class="py-2 pr-3">Último servicio</th></tr></thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.user.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pr-3"><div class="font-medium text-slate-950">{{ customerName(row.user) }}</div><div class="text-xs text-slate-500">{{ row.user.email || shortId(row.user.id) }}</div></td>
              <td class="py-3 pr-3"><span :class="['rounded-md px-2 py-1 text-xs font-medium', row.blocked ? 'bg-rose-50 text-rose-700' : row.risk ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800']">{{ row.type }}</span></td>
              <td class="py-3 pr-3">{{ row.reason }}</td>
              <td class="py-3 pr-3">{{ row.stats.canceled }}</td>
              <td class="py-3 pr-3">{{ row.stats.noShow }}</td>
              <td class="py-3 pr-3">{{ formatDate(row.stats.lastAt) }}</td>
            </tr>
            <tr v-if="!state.loading && filteredRows.length === 0"><td class="py-10 text-center text-slate-500" colspan="6">No hay clientes para los filtros actuales.</td></tr>
            <tr v-if="state.loading"><td class="py-10 text-center text-slate-500" colspan="6">Cargando bloqueos...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
