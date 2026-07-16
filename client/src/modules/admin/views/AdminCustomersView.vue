<script setup>
import { computed, onMounted, reactive } from "vue";
import { RefreshCw, Search, UserRound, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const state = reactive({
  loading: true,
  error: "",
  users: [],
  rides: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
  status: "all",
});

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

async function fetchCustomers() {
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
    state.error = err?.message || "No se pudieron cargar clientes.";
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

function customerName(customer) {
  if (customer.fullName) return customer.fullName;
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return name || customer.email || shortId(customer.id);
}

function isActiveRide(ride) {
  return !terminalStatuses.includes(ride.status);
}

const customers = computed(() => {
  const byCustomer = new Map();

  for (const user of state.users) {
    byCustomer.set(user.id, {
      id: user.id,
      email: user.email || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      fullName: [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
      status: user.status || "",
      rating: user.clientProfile?.rating || 0,
      totalServices: 0,
      activeServices: 0,
      completedServices: 0,
      canceledServices: 0,
      lastServiceAt: null,
      lastStatus: "",
      lastPickup: "",
      lastDropoff: "",
    });
  }

  for (const ride of state.rides) {
    if (!ride.clientId) continue;
    const passenger = ride.passenger || ride.client || {};
    const current = byCustomer.get(ride.clientId) || {
      id: ride.clientId,
      email: passenger.email || "",
      firstName: passenger.firstName || "",
      lastName: passenger.lastName || "",
      fullName: passenger.fullName || "",
      status: "",
      rating: 0,
      totalServices: 0,
      activeServices: 0,
      completedServices: 0,
      canceledServices: 0,
      lastServiceAt: null,
      lastStatus: "",
      lastPickup: "",
      lastDropoff: "",
    };

    current.totalServices += 1;
    if (isActiveRide(ride)) current.activeServices += 1;
    if (ride.status === "completed") current.completedServices += 1;
    if (String(ride.status || "").startsWith("canceled") || ride.status === "no_show") {
      current.canceledServices += 1;
    }

    const rideTime = new Date(ride.requestedAt || 0).getTime();
    const currentTime = new Date(current.lastServiceAt || 0).getTime();
    if (!current.lastServiceAt || rideTime > currentTime) {
      current.lastServiceAt = ride.requestedAt;
      current.lastStatus = ride.status;
      current.lastPickup = ride.pickupAddress;
      current.lastDropoff = ride.dropoffAddress;
    }

    byCustomer.set(ride.clientId, current);
  }

  return Array.from(byCustomer.values()).sort((a, b) => {
    return new Date(b.lastServiceAt || 0).getTime() - new Date(a.lastServiceAt || 0).getTime();
  });
});

const filteredCustomers = computed(() => {
  const q = filters.search.trim().toLowerCase();

  return customers.value.filter((customer) => {
    if (filters.status === "active" && customer.activeServices === 0) return false;
    if (filters.status === "completed" && customer.completedServices === 0) return false;
    if (filters.status === "canceled" && customer.canceledServices === 0) return false;
    if (!q) return true;

    return (
      String(customer.id || "").toLowerCase().includes(q) ||
      String(customer.email || "").toLowerCase().includes(q) ||
      String(customer.firstName || "").toLowerCase().includes(q) ||
      String(customer.lastName || "").toLowerCase().includes(q)
    );
  });
});

const summary = computed(() => {
  const total = customers.value.length;
  const active = customers.value.filter((customer) => customer.activeServices > 0).length;
  const recurring = customers.value.filter((customer) => customer.totalServices > 1).length;
  const canceled = customers.value.filter((customer) => customer.canceledServices > 0).length;

  return [
    { label: "Clientes", value: total },
    { label: "Activos", value: active },
    { label: "Recurrentes", value: recurring },
    { label: "Con cancelaciones", value: canceled },
  ];
});

onMounted(fetchCustomers);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Clientes</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Listado</h1>
        <p class="mt-1 text-sm text-slate-500">Clientes recientes, servicios activos e historial resumido.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchCustomers"
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
            <Users v-if="item.label === 'Clientes'" class="h-4 w-4" />
            <UserRound v-else class="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white p-4">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Clientes</h2>
          <p class="text-sm text-slate-500">
            {{ filteredCustomers.length }} visibles
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
            <option value="active">Con servicios activos</option>
            <option value="completed">Con finalizados</option>
            <option value="canceled">Con cancelaciones</option>
          </select>
        </div>
      </div>

      <div class="overflow-auto">
        <table class="w-full min-w-[920px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pr-3">Cliente</th>
              <th class="py-2 pr-3">Servicios</th>
              <th class="py-2 pr-3">Activos</th>
              <th class="py-2 pr-3">Finalizados</th>
              <th class="py-2 pr-3">Cancelados</th>
              <th class="py-2 pr-3">Último servicio</th>
              <th class="py-2 pr-3">Última ruta</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="customer in filteredCustomers" :key="customer.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ customerName(customer) }}</div>
                <div class="font-mono text-xs text-slate-500">{{ shortId(customer.id) }}</div>
                <div class="text-xs text-slate-500">{{ customer.email || "-" }}</div>
              </td>
              <td class="py-3 pr-3 font-semibold text-slate-950">{{ customer.totalServices }}</td>
              <td class="py-3 pr-3">{{ customer.activeServices }}</td>
              <td class="py-3 pr-3">{{ customer.completedServices }}</td>
              <td class="py-3 pr-3">{{ customer.canceledServices }}</td>
              <td class="py-3 pr-3">
                <div>{{ formatDate(customer.lastServiceAt) }}</div>
                <div class="text-xs text-slate-500">{{ customer.lastStatus || "-" }}</div>
              </td>
              <td class="py-3 pr-3">
                <div class="max-w-[280px] truncate text-slate-800">{{ customer.lastPickup || "-" }}</div>
                <div class="max-w-[280px] truncate text-xs text-slate-500">{{ customer.lastDropoff || "-" }}</div>
              </td>
            </tr>
            <tr v-if="!state.loading && filteredCustomers.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="7">No hay clientes para los filtros actuales.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="7">Cargando clientes...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
