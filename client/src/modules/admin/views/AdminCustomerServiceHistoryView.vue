<script setup>
import { computed, onMounted, reactive } from "vue";
import { Clock3, Copy, RefreshCw, Search, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const terminalStatuses = ["completed", "canceled_by_client", "canceled_by_driver", "canceled_by_system", "no_show"];

const state = reactive({
  loading: true,
  error: "",
  rides: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
  status: "all",
});

async function fetchHistory() {
  state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" });
    state.rides = data?.rides || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudo cargar el historial de servicios.";
  } finally {
    state.loading = false;
  }
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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function customerName(ride) {
  const passenger = ride.passenger || {};
  return passenger.fullName || [passenger.firstName, passenger.lastName].filter(Boolean).join(" ").trim() || passenger.email || shortId(ride.clientId);
}

function statusLabel(status) {
  const labels = {
    requested: "Solicitada",
    pending_driver: "Buscando conductor",
    driver_assigned: "Asignada",
    driver_en_route: "En camino",
    driver_arrived: "Conductor llegó",
    in_progress: "En curso",
    completed: "Finalizada",
    canceled_by_client: "Cancelada cliente",
    canceled_by_driver: "Cancelada conductor",
    canceled_by_system: "Cancelada sistema",
    no_show: "No show",
  };
  return labels[status] || status || "-";
}

const filteredRides = computed(() => {
  const query = filters.search.trim().toLowerCase();

  return state.rides.filter((ride) => {
    if (filters.status === "active" && terminalStatuses.includes(ride.status)) return false;
    if (filters.status === "completed" && ride.status !== "completed") return false;
    if (filters.status === "canceled" && !String(ride.status || "").startsWith("canceled") && ride.status !== "no_show") return false;
    if (!query) return true;

    return [
      ride.id,
      ride.clientId,
      customerName(ride),
      ride.passenger?.email,
      ride.pickupAddress,
      ride.dropoffAddress,
      ride.status,
    ].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
});

const summary = computed(() => [
  { label: "Servicios", value: state.rides.length, icon: Clock3 },
  { label: "Clientes", value: new Set(state.rides.map((ride) => ride.clientId).filter(Boolean)).size, icon: Users },
  { label: "Activos", value: state.rides.filter((ride) => !terminalStatuses.includes(ride.status)).length, icon: Clock3 },
  { label: "Finalizados", value: state.rides.filter((ride) => ride.status === "completed").length, icon: Clock3 },
]);

onMounted(fetchHistory);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Clientes</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Historial de Servicios</h1>
        <p class="mt-1 text-sm text-slate-500">Servicios recientes asociados a clientes reales.</p>
      </div>
      <button class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60" :disabled="state.loading" type="button" @click="fetchHistory">
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{{ state.error }}</div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
          </div>
          <div class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white"><component :is="item.icon" class="h-4 w-4" /></div>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white p-4">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Servicios</h2>
          <p class="text-sm text-slate-500">{{ filteredRides.length }} visibles <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span></p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input v-model.trim="filters.search" class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" placeholder="Buscar cliente, dirección o ID" />
          </label>
          <select v-model="filters.status" class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10">
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="completed">Finalizados</option>
            <option value="canceled">Cancelados</option>
          </select>
        </div>
      </div>

      <div class="overflow-auto">
        <table class="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Servicio</th>
              <th class="py-2 pr-3">Cliente</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Origen</th>
              <th class="py-2 pr-3">Destino</th>
              <th class="py-2 pr-3">Fecha</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ride in filteredRides" :key="ride.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pr-3">
                <div class="flex items-center gap-1">
                  <span class="font-mono text-xs font-semibold text-slate-950">#{{ shortId(ride.id) }}</span>
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
              <td class="py-3 pr-3"><div class="font-medium text-slate-950">{{ customerName(ride) }}</div><div class="text-xs text-slate-500">{{ ride.passenger?.email || shortId(ride.clientId) }}</div></td>
              <td class="py-3 pr-3">{{ statusLabel(ride.status) }}</td>
              <td class="max-w-[260px] truncate py-3 pr-3" :title="ride.pickupAddress">{{ ride.pickupAddress || "-" }}</td>
              <td class="max-w-[260px] truncate py-3 pr-3" :title="ride.dropoffAddress">{{ ride.dropoffAddress || "-" }}</td>
              <td class="py-3 pr-3">{{ formatDate(ride.requestedAt) }}</td>
            </tr>
            <tr v-if="!state.loading && filteredRides.length === 0"><td class="py-10 text-center text-slate-500" colspan="6">No hay servicios para los filtros actuales.</td></tr>
            <tr v-if="state.loading"><td class="py-10 text-center text-slate-500" colspan="6">Cargando historial...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
