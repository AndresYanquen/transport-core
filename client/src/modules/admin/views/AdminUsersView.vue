<script setup>
import { computed, onMounted, reactive } from "vue";
import { Plus, RefreshCw, UserPlus } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const roles = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operadora" },
  { value: "client", label: "Cliente" },
  { value: "driver", label: "Conductor" },
];

const state = reactive({
  users: [],
  loading: false,
  saving: false,
  error: "",
  success: "",
});

const filters = reactive({
  role: "",
  search: "",
});

const columnFilters = reactive({
  user: "",
  role: "",
  status: "",
  createdFrom: "",
  createdTo: "",
});

const pagination = reactive({
  page: 1,
  pageSize: 8,
});

const form = reactive({
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  phoneNumber: "",
  username: "",
  role: "operator",
  status: "active",
  clientProfile: {
    defaultPaymentMethod: "",
    preferredLanguage: "es",
  },
  driverProfile: {
    licenseNumber: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleYear: "",
    vehicleColor: "",
    vehiclePlate: "",
    vehicleType: "standard",
    serviceType: "standard",
  },
});

const showClientFields = computed(() => form.role === "client");
const showDriverFields = computed(() => form.role === "driver");
const filteredUsers = computed(() => {
  const userFilter = columnFilters.user.trim().toLowerCase();
  const createdRange = getCreatedAtRange();

  return state.users.filter((user) => {
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ");
    const userHaystack = [
      user.email,
      user.username,
      displayName,
      user.phoneNumber,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (userFilter && !userHaystack.includes(userFilter)) return false;
    if (columnFilters.role && user.role !== columnFilters.role) return false;
    if (columnFilters.status && user.status !== columnFilters.status) return false;
    if (createdRange) {
      const createdAt = new Date(user.createdAt).getTime();
      if (!Number.isFinite(createdAt)) return false;
      if (createdAt < createdRange.from || createdAt > createdRange.to) return false;
    }
    return true;
  });
});
const totalPages = computed(() => Math.max(1, Math.ceil(filteredUsers.value.length / pagination.pageSize)));
const pageStart = computed(() => (pagination.page - 1) * pagination.pageSize);
const pageEnd = computed(() => Math.min(pageStart.value + pagination.pageSize, filteredUsers.value.length));
const paginatedUsers = computed(() => filteredUsers.value.slice(pageStart.value, pageEnd.value));

function setPage(page) {
  pagination.page = Math.min(Math.max(page, 1), totalPages.value);
}

function resetForm() {
  form.email = "";
  form.password = "";
  form.firstName = "";
  form.lastName = "";
  form.phoneNumber = "";
  form.username = "";
  form.role = "operator";
  form.status = "active";
  form.clientProfile.defaultPaymentMethod = "";
  form.clientProfile.preferredLanguage = "es";
  form.driverProfile.licenseNumber = "";
  form.driverProfile.vehicleMake = "";
  form.driverProfile.vehicleModel = "";
  form.driverProfile.vehicleYear = "";
  form.driverProfile.vehicleColor = "";
  form.driverProfile.vehiclePlate = "";
  form.driverProfile.vehicleType = "standard";
  form.driverProfile.serviceType = "standard";
}

function buildPayload() {
  const payload = {
    email: form.email,
    password: form.password,
    firstName: form.firstName || undefined,
    lastName: form.lastName || undefined,
    phoneNumber: form.phoneNumber || undefined,
    username: form.username || undefined,
    role: form.role,
    status: form.status,
  };

  if (form.role === "client") {
    payload.clientProfile = {
      defaultPaymentMethod: form.clientProfile.defaultPaymentMethod || undefined,
      preferredLanguage: form.clientProfile.preferredLanguage || undefined,
    };
  }

  if (form.role === "driver") {
    payload.driverProfile = {
      licenseNumber: form.driverProfile.licenseNumber,
      vehicleMake: form.driverProfile.vehicleMake,
      vehicleModel: form.driverProfile.vehicleModel,
      vehicleYear: form.driverProfile.vehicleYear ? Number(form.driverProfile.vehicleYear) : undefined,
      vehicleColor: form.driverProfile.vehicleColor || undefined,
      vehiclePlate: form.driverProfile.vehiclePlate,
      vehicleType: form.driverProfile.vehicleType || undefined,
      serviceType: form.driverProfile.serviceType || undefined,
    };
  }

  return payload;
}

async function fetchUsers() {
  state.loading = true;
  state.error = "";

  try {
    const params = new URLSearchParams({ limit: "100" });
    if (filters.role) params.set("role", filters.role);
    if (filters.search.trim()) params.set("search", filters.search.trim());

    const result = await apiRequest(`/api/admin/users?${params.toString()}`, {
      method: "GET",
    });
    state.users = result?.users || [];
    setPage(1);
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar usuarios.";
  } finally {
    state.loading = false;
  }
}

async function createUser() {
  state.saving = true;
  state.error = "";
  state.success = "";

  try {
    const result = await apiRequest("/api/admin/users", {
      method: "POST",
      body: buildPayload(),
    });

    state.success = `Usuario creado: ${result?.user?.email || form.email}`;
    resetForm();
    await fetchUsers();
  } catch (err) {
    state.error = err?.message || "No se pudo crear el usuario.";
  } finally {
    state.saving = false;
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function dateInputToRange(dateValue, endOfDay = false) {
  if (!dateValue) return null;
  const [year, month, day] = String(dateValue).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ).getTime();
}

function getCreatedAtRange() {
  const fromInput = columnFilters.createdFrom || columnFilters.createdTo;
  const toInput = columnFilters.createdTo || columnFilters.createdFrom;
  const from = dateInputToRange(fromInput, false);
  const to = dateInputToRange(toInput, true);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

function resetColumnFilters() {
  columnFilters.user = "";
  columnFilters.role = "";
  columnFilters.status = "";
  columnFilters.createdFrom = "";
  columnFilters.createdTo = "";
  setPage(1);
}

onMounted(fetchUsers);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Seguridad</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Usuarios</h1>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        type="button"
        @click="fetchUsers"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>
    <div v-if="state.success" class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {{ state.success }}
    </div>

    <div class="grid gap-4 xl:grid-cols-[420px_1fr]">
      <form class="rounded-md border border-slate-200 bg-white p-4" @submit.prevent="createUser">
        <div class="mb-4 flex items-center gap-2">
          <div class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <UserPlus class="h-4 w-4" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-slate-950">Crear usuario</h2>
            <p class="text-sm text-slate-500">Admin, operadora, cliente o conductor.</p>
          </div>
        </div>

        <div class="grid gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Rol
              <select v-model="form.role" class="h-10 rounded-md border border-slate-300 px-3 text-sm">
                <option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option>
              </select>
            </label>
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Estado
              <select v-model="form.status" class="h-10 rounded-md border border-slate-300 px-3 text-sm">
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="suspended">Suspendido</option>
              </select>
            </label>
          </div>

          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input v-model.trim="form.email" class="h-10 rounded-md border border-slate-300 px-3 text-sm" required type="email" />
          </label>

          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Contraseña
            <input v-model="form.password" class="h-10 rounded-md border border-slate-300 px-3 text-sm" minlength="6" required type="password" />
          </label>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Nombre
              <input v-model.trim="form.firstName" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
            </label>
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Apellido
              <input v-model.trim="form.lastName" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
            </label>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Teléfono
              <input v-model.trim="form.phoneNumber" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
            </label>
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Usuario
              <input v-model.trim="form.username" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
            </label>
          </div>

          <div v-if="showClientFields" class="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div class="text-sm font-semibold text-slate-800">Perfil cliente</div>
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Método de pago
              <input v-model.trim="form.clientProfile.defaultPaymentMethod" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
            </label>
          </div>

          <div v-if="showDriverFields" class="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div class="text-sm font-semibold text-slate-800">Perfil conductor</div>
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Licencia
              <input v-model.trim="form.driverProfile.licenseNumber" class="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Marca
                <input v-model.trim="form.driverProfile.vehicleMake" class="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              </label>
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Modelo
                <input v-model.trim="form.driverProfile.vehicleModel" class="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              </label>
            </div>
            <div class="grid gap-3">
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Placa
                <input v-model.trim="form.driverProfile.vehiclePlate" class="h-10 rounded-md border border-slate-300 px-3 text-sm" required />
              </label>
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Año
                <input v-model="form.driverProfile.vehicleYear" class="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" />
              </label>
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Color
                <input v-model.trim="form.driverProfile.vehicleColor" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
              </label>
            </div>
          </div>

          <button
            class="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="state.saving"
            type="submit"
          >
            <Plus class="h-4 w-4" />
            {{ state.saving ? "Creando..." : "Crear usuario" }}
          </button>
        </div>
      </form>

      <div class="flex h-[640px] min-h-0 flex-col rounded-md border border-slate-200 bg-white p-4">
        <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Usuarios recientes</h2>
            <p class="text-sm text-slate-500">
              {{ filteredUsers.length }} de {{ state.users.length }} registros
              <span v-if="filteredUsers.length"> · mostrando {{ pageStart + 1 }}-{{ pageEnd }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <input
              v-model.trim="filters.search"
              class="h-9 w-56 rounded-md border border-slate-300 px-3 text-sm"
              placeholder="Buscar"
              @keyup.enter="fetchUsers"
            />
            <select v-model="filters.role" class="h-9 rounded-md border border-slate-300 px-3 text-sm" @change="fetchUsers">
              <option value="">Todos</option>
              <option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option>
            </select>
            <button
              class="h-9 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
              type="button"
              @click="resetColumnFilters"
            >
              Limpiar columnas
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto rounded-md border border-slate-100">
          <table class="w-full border-collapse text-sm">
            <thead class="sticky top-0 bg-white">
              <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th class="py-2 pr-3">Usuario</th>
                <th class="py-2 pr-3">Rol</th>
                <th class="py-2 pr-3">Estado</th>
                <th class="py-2 pr-3">Creado</th>
              </tr>
              <tr class="border-b border-slate-200 bg-slate-50">
                <th class="py-2 pr-3">
                  <input
                    v-model.trim="columnFilters.user"
                    class="h-8 w-full rounded-md border border-slate-300 px-2 text-xs font-normal normal-case tracking-normal text-slate-700"
                    placeholder="Filtrar usuario"
                    @input="setPage(1)"
                  />
                </th>
                <th class="py-2 pr-3">
                  <select
                    v-model="columnFilters.role"
                    class="h-8 w-full rounded-md border border-slate-300 px-2 text-xs font-normal normal-case tracking-normal text-slate-700"
                    @change="setPage(1)"
                  >
                    <option value="">Todos</option>
                    <option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option>
                  </select>
                </th>
                <th class="py-2 pr-3">
                  <select
                    v-model="columnFilters.status"
                    class="h-8 w-full rounded-md border border-slate-300 px-2 text-xs font-normal normal-case tracking-normal text-slate-700"
                    @change="setPage(1)"
                  >
                    <option value="">Todos</option>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo</option>
                    <option value="suspended">Suspendido</option>
                  </select>
                </th>
                <th class="py-2 pr-3">
                  <div class="grid gap-1">
                    <input
                      v-model="columnFilters.createdFrom"
                      class="h-8 w-full rounded-md border border-slate-300 px-2 text-xs font-normal normal-case tracking-normal text-slate-700"
                      title="Desde"
                      type="date"
                      @input="setPage(1)"
                    />
                    <input
                      v-model="columnFilters.createdTo"
                      class="h-8 w-full rounded-md border border-slate-300 px-2 text-xs font-normal normal-case tracking-normal text-slate-700"
                      title="Hasta"
                      type="date"
                      @input="setPage(1)"
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in paginatedUsers" :key="user.id" class="border-b border-slate-100 text-slate-700">
                <td class="py-2 pr-3">
                  <div class="font-medium text-slate-950">{{ user.email }}</div>
                  <div class="text-xs text-slate-500">{{ [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "-" }}</div>
                </td>
                <td class="py-2 pr-3">{{ user.role }}</td>
                <td class="py-2 pr-3">{{ user.status }}</td>
                <td class="py-2 pr-3">{{ formatDate(user.createdAt) }}</td>
              </tr>
              <tr v-if="!state.loading && filteredUsers.length === 0">
                <td class="py-8 text-center text-slate-500" colspan="4">No hay usuarios.</td>
              </tr>
              <tr v-if="state.loading">
                <td class="py-8 text-center text-slate-500" colspan="4">Cargando...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <div class="text-sm text-slate-500">
            Página {{ pagination.page }} de {{ totalPages }}
          </div>
          <div class="flex items-center gap-2">
            <button
              class="h-8 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="pagination.page <= 1"
              type="button"
              @click="setPage(pagination.page - 1)"
            >
              Anterior
            </button>
            <button
              class="h-8 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="pagination.page >= totalPages"
              type="button"
              @click="setPage(pagination.page + 1)"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
