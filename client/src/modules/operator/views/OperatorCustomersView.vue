<script setup>
import { computed, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Clock3, Mail, Phone, Plus, RefreshCw, Search, UserPlus, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const route = useRoute();
const router = useRouter();

const tabs = [
  { key: "search", slug: "search-client", label: "Buscar Cliente" },
  { key: "history", slug: "history", label: "Historial" },
  { key: "create", slug: "create-client", label: "Crear Cliente" },
];

const tabAliases = {
  ...Object.fromEntries(tabs.map((tab) => [tab.slug, tab.key])),
  "buscar-cliente": "search",
  historial: "history",
  "crear-cliente": "create",
};

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

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
  error: "",
  toast: null,
  users: [],
  rides: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  search: "",
  historyStatus: "all",
});

const form = reactive({
  firstName: "",
  lastName: "",
  phoneNumber: "",
  email: "",
  password: "",
});

let toastTimer = null;

function resolveRouteTab() {
  const param = Array.isArray(route.params.customerView) ? route.params.customerView[0] : route.params.customerView;
  return tabAliases[String(param || "").toLowerCase()] || "search";
}

function setTab(tabKey) {
  const tab = tabs.find((item) => item.key === tabKey) || tabs[0];
  filters.tab = tab.key;
  router.replace(`/operator/clientes/${tab.slug}`);
}

async function fetchCustomers({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
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
    state.error = err?.message || "No se pudieron cargar los clientes.";
    if (!quiet) showToast(state.error, "error");
  } finally {
    state.loading = false;
  }
}

async function createCustomer() {
  state.saving = true;
  state.error = "";

  try {
    await apiRequest("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        role: "client",
        status: "active",
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phoneNumber: form.phoneNumber.trim(),
        email: form.email.trim(),
        password: form.password,
      }),
    });
    resetForm();
    showToast("Cliente creado correctamente.");
    await fetchCustomers({ quiet: true });
    setTab("search");
  } catch (err) {
    showToast(err?.message || "No se pudo crear el cliente.", "error");
  } finally {
    state.saving = false;
  }
}

function resetForm() {
  form.firstName = "";
  form.lastName = "";
  form.phoneNumber = "";
  form.email = "";
  form.password = "";
}

function showToast(message, type = "success") {
  state.toast = { message, type };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    toastTimer = null;
  }, 2800);
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

function customerName(customer) {
  const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(" ").trim();
  return name || customer?.email || customer?.phoneNumber || shortId(customer?.id);
}

function passengerName(ride) {
  const passenger = ride?.passenger || ride?.client || {};
  const name = [passenger.firstName, passenger.lastName].filter(Boolean).join(" ").trim();
  return name || passenger.email || passenger.phoneNumber || shortId(ride?.clientId);
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isActiveRide(ride) {
  return !terminalStatuses.includes(ride.status);
}

const activeTab = computed(() => tabs.find((tab) => tab.key === filters.tab) || tabs[0]);

const customers = computed(() => {
  const byCustomer = new Map();

  for (const user of state.users) {
    byCustomer.set(user.id, {
      id: user.id,
      email: user.email || "",
      phoneNumber: user.phoneNumber || "",
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      status: user.status || "",
      rating: user.clientProfile?.rating || null,
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
      phoneNumber: passenger.phoneNumber || "",
      firstName: passenger.firstName || "",
      lastName: passenger.lastName || "",
      status: "",
      rating: null,
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
    if (String(ride.status || "").startsWith("canceled") || ride.status === "no_show") current.canceledServices += 1;

    const rideTime = new Date(ride.requestedAt || ride.createdAt || 0).getTime();
    const currentTime = new Date(current.lastServiceAt || 0).getTime();
    if (!current.lastServiceAt || rideTime > currentTime) {
      current.lastServiceAt = ride.requestedAt || ride.createdAt;
      current.lastStatus = ride.status;
      current.lastPickup = ride.pickupAddress;
      current.lastDropoff = ride.dropoffAddress;
    }

    byCustomer.set(ride.clientId, current);
  }

  return Array.from(byCustomer.values()).sort((a, b) => {
    return new Date(b.lastServiceAt || b.createdAt || 0).getTime() - new Date(a.lastServiceAt || a.createdAt || 0).getTime();
  });
});

const filteredCustomers = computed(() => {
  const query = normalize(filters.search.trim());
  return customers.value.filter((customer) => {
    if (!query) return true;
    return normalize([
      customer.id,
      customerName(customer),
      customer.email,
      customer.phoneNumber,
      customer.lastPickup,
      customer.lastDropoff,
    ].filter(Boolean).join(" ")).includes(query);
  });
});

const historyRows = computed(() => {
  const query = normalize(filters.search.trim());
  return state.rides
    .filter((ride) => {
      if (filters.historyStatus === "active" && !isActiveRide(ride)) return false;
      if (filters.historyStatus === "completed" && ride.status !== "completed") return false;
      if (filters.historyStatus === "canceled" && !(String(ride.status || "").startsWith("canceled") || ride.status === "no_show")) return false;
      if (!query) return true;
      return normalize([
        ride.id,
        ride.clientId,
        passengerName(ride),
        ride.passenger?.email,
        ride.passenger?.phoneNumber,
        ride.pickupAddress,
        ride.dropoffAddress,
        ride.status,
      ].filter(Boolean).join(" ")).includes(query);
    })
    .sort((a, b) => new Date(b.requestedAt || b.createdAt || 0).getTime() - new Date(a.requestedAt || a.createdAt || 0).getTime());
});

const summary = computed(() => [
  { label: "Clientes", value: customers.value.length, icon: Users },
  { label: "Activos", value: customers.value.filter((customer) => customer.activeServices > 0).length, icon: UserPlus },
  { label: "Servicios", value: state.rides.length, icon: Clock3 },
  { label: "Nuevos", value: state.users.filter((user) => {
    const created = new Date(user.createdAt || 0).getTime();
    return created && Date.now() - created <= 7 * 24 * 60 * 60 * 1000;
  }).length, icon: Plus },
]);

watch(() => route.params.customerView, () => {
  filters.tab = resolveRouteTab();
});

onMounted(fetchCustomers);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Clientes</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">{{ activeTab.label }}</h1>
        <p class="mt-1 text-sm text-slate-500">Búsqueda, historial y creación de clientes con datos reales.</p>
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

    <div
      v-if="state.toast"
      :class="[
        'rounded-md border px-3 py-2 text-sm',
        state.toast.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800',
      ]"
    >
      {{ state.toast.message }}
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

    <div class="rounded-md border border-slate-200 bg-white">
      <div class="border-b border-slate-200 p-4">
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
      </div>

      <div v-if="activeTab.key !== 'create'" class="border-b border-slate-200 p-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <label class="relative block w-full max-w-lg">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-10 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar cliente, teléfono, email, dirección o ID"
            />
          </label>
          <select
            v-if="activeTab.key === 'history'"
            v-model="filters.historyStatus"
            class="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="all">Todos los servicios</option>
            <option value="active">Activos</option>
            <option value="completed">Finalizados</option>
            <option value="canceled">Cancelados</option>
          </select>
        </div>
      </div>

      <div v-if="activeTab.key === 'search'" class="overflow-auto">
        <table class="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Cliente</th>
              <th class="py-2 pr-3">Contacto</th>
              <th class="py-2 pr-3">Servicios</th>
              <th class="py-2 pr-3">Activos</th>
              <th class="py-2 pr-3">Finalizados</th>
              <th class="py-2 pr-3">Cancelados</th>
              <th class="py-2 pr-4">Último servicio</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="customer in filteredCustomers" :key="customer.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="font-medium text-slate-950">{{ customerName(customer) }}</div>
                <div class="font-mono text-xs text-slate-500">{{ shortId(customer.id) }}</div>
              </td>
              <td class="py-3 pr-3">
                <div class="flex items-center gap-1"><Phone class="h-3.5 w-3.5 text-slate-400" />{{ customer.phoneNumber || "-" }}</div>
                <div class="mt-1 flex items-center gap-1 text-xs text-slate-500"><Mail class="h-3.5 w-3.5 text-slate-400" />{{ customer.email || "-" }}</div>
              </td>
              <td class="py-3 pr-3 font-semibold text-slate-950">{{ customer.totalServices }}</td>
              <td class="py-3 pr-3">{{ customer.activeServices }}</td>
              <td class="py-3 pr-3">{{ customer.completedServices }}</td>
              <td class="py-3 pr-3">{{ customer.canceledServices }}</td>
              <td class="py-3 pr-4">
                <div>{{ formatDate(customer.lastServiceAt) }}</div>
                <div class="max-w-[320px] truncate text-xs text-slate-500">{{ customer.lastPickup || "-" }}</div>
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

      <div v-else-if="activeTab.key === 'history'" class="overflow-auto">
        <table class="w-full min-w-[1080px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Solicitud</th>
              <th class="py-2 pr-3">Cliente</th>
              <th class="py-2 pr-3">Estado</th>
              <th class="py-2 pr-3">Origen</th>
              <th class="py-2 pr-3">Destino</th>
              <th class="py-2 pr-4">Fecha</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ride in historyRows" :key="ride.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3 font-mono text-xs text-slate-600">#{{ shortId(ride.id) }}</td>
              <td class="py-3 pr-3">
                <div class="font-medium text-slate-950">{{ passengerName(ride) }}</div>
                <div class="text-xs text-slate-500">{{ ride.passenger?.phoneNumber || ride.passenger?.email || shortId(ride.clientId) }}</div>
              </td>
              <td class="py-3 pr-3">{{ statusLabels[ride.status] || ride.status || "-" }}</td>
              <td class="py-3 pr-3"><div class="max-w-[280px] truncate">{{ ride.pickupAddress || "-" }}</div></td>
              <td class="py-3 pr-3"><div class="max-w-[280px] truncate">{{ ride.dropoffAddress || "-" }}</div></td>
              <td class="py-3 pr-4">{{ formatDate(ride.requestedAt || ride.createdAt) }}</td>
            </tr>
            <tr v-if="!state.loading && historyRows.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="6">No hay historial para los filtros actuales.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="6">Cargando historial...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <form v-else class="grid gap-4 p-4 md:max-w-3xl" @submit.prevent="createCustomer">
        <div>
          <h2 class="text-base font-semibold text-slate-950">Crear cliente</h2>
          <p class="text-sm text-slate-500">El operador crea una cuenta de cliente activa para futuras solicitudes.</p>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="grid gap-1 text-sm text-slate-600">
            Nombre
            <input v-model.trim="form.firstName" class="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" />
          </label>
          <label class="grid gap-1 text-sm text-slate-600">
            Apellido
            <input v-model.trim="form.lastName" class="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" />
          </label>
          <label class="grid gap-1 text-sm text-slate-600">
            Teléfono
            <input v-model.trim="form.phoneNumber" class="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" />
          </label>
          <label class="grid gap-1 text-sm text-slate-600">
            Email
            <input v-model.trim="form.email" required type="email" class="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" />
          </label>
          <label class="grid gap-1 text-sm text-slate-600 md:col-span-2">
            Contraseña temporal
            <input v-model="form.password" required minlength="6" type="password" class="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" />
          </label>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button class="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" @click="resetForm">
            Limpiar
          </button>
          <button class="h-10 rounded-md bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60" :disabled="state.saving" type="submit">
            Crear cliente
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
