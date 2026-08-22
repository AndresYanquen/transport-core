<script setup>
import { computed, onMounted, reactive } from "vue";
import { CheckCircle2, RefreshCw, Search, ShieldAlert, XCircle } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const statusOptions = [
  { value: "pending", label: "Pendientes" },
  { value: "changes_requested", label: "Cambios solicitados" },
  { value: "rejected", label: "Rechazados" },
  { value: "approved", label: "Aprobados" },
  { value: "all", label: "Todos" },
];

const statusMeta = {
  pending: { label: "Pendiente", class: "border-amber-200 bg-amber-50 text-amber-800" },
  approved: { label: "Aprobado", class: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  rejected: { label: "Rechazado", class: "border-rose-200 bg-rose-50 text-rose-700" },
  changes_requested: { label: "Solicitar cambios", class: "border-sky-200 bg-sky-50 text-sky-700" },
  suspended: { label: "Suspendido", class: "border-slate-300 bg-slate-100 text-slate-700" },
};

const state = reactive({
  loading: true,
  saving: "",
  error: "",
  success: "",
  drivers: [],
  selectedDriverId: "",
});

const filters = reactive({
  status: "pending",
  search: "",
});

const form = reactive({
  approvalNotes: "",
});

const selectedDriver = computed(() =>
  state.drivers.find((driver) => driver.id === state.selectedDriverId) || state.drivers[0] || null,
);

async function fetchDrivers() {
  state.loading = true;
  state.error = "";
  state.success = "";

  try {
    const params = new URLSearchParams({
      status: filters.status,
      limit: "200",
    });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    const result = await apiRequest(`/api/admin/users/drivers/approvals?${params}`, { method: "GET" });
    state.drivers = result?.drivers || [];
    if (!state.drivers.some((driver) => driver.id === state.selectedDriverId)) {
      state.selectedDriverId = state.drivers[0]?.id || "";
    }
  } catch (error) {
    state.error = error?.message || "No se pudieron cargar aprobaciones.";
  } finally {
    state.loading = false;
  }
}

function driverName(driver) {
  const name = [driver?.firstName, driver?.lastName].filter(Boolean).join(" ").trim();
  return name || driver?.email || "-";
}

function statusLabel(status) {
  return statusMeta[status]?.label || status || "-";
}

function statusClass(status) {
  return statusMeta[status]?.class || "border-slate-200 bg-white text-slate-600";
}

function documentEntries(driver) {
  const docs = driver?.driverProfile?.documents || {};
  return Object.entries(docs).filter(([, value]) => value !== null && value !== undefined && value !== "");
}

async function updateApproval(approvalStatus) {
  const driver = selectedDriver.value;
  if (!driver) return;
  state.saving = approvalStatus;
  state.error = "";
  state.success = "";

  try {
    await apiRequest(`/api/admin/users/drivers/${driver.id}/approval`, {
      method: "PATCH",
      body: {
        approvalStatus,
        approvalNotes: form.approvalNotes,
      },
    });
    state.success = `Estado actualizado: ${statusLabel(approvalStatus)}.`;
    form.approvalNotes = "";
    await fetchDrivers();
  } catch (error) {
    state.error = error?.message || "No se pudo actualizar la aprobación.";
  } finally {
    state.saving = "";
  }
}

onMounted(fetchDrivers);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Conductores</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Aprobaciones</h1>
        <p class="mt-1 text-sm text-slate-500">Revisa perfiles, vehículos y documentos antes de habilitar conductores.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        :disabled="state.loading"
        type="button"
        @click="fetchDrivers"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{{ state.error }}</div>
    <div v-if="state.success" class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{{ state.success }}</div>

    <div class="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div class="rounded-md border border-slate-200 bg-white">
        <div class="border-b border-slate-200 p-4">
          <div class="grid gap-3 md:grid-cols-[1fr_220px] xl:grid-cols-1">
            <label class="relative">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                v-model.trim="filters.search"
                class="h-9 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="Buscar conductor, licencia o placa"
                @keyup.enter="fetchDrivers"
              />
            </label>
            <select v-model="filters.status" class="h-9 rounded-md border border-slate-300 px-3 text-sm" @change="fetchDrivers">
              <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
        </div>

        <div class="max-h-[640px] overflow-auto">
          <button
            v-for="driver in state.drivers"
            :key="driver.id"
            :class="[
              'grid w-full gap-2 border-b border-slate-100 p-4 text-left hover:bg-slate-50',
              selectedDriver?.id === driver.id ? 'bg-slate-50' : 'bg-white',
            ]"
            type="button"
            @click="state.selectedDriverId = driver.id"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate font-medium text-slate-950">{{ driverName(driver) }}</div>
                <div class="truncate text-xs text-slate-500">{{ driver.email }}</div>
              </div>
              <span :class="['shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold', statusClass(driver.driverProfile.approvalStatus)]">
                {{ statusLabel(driver.driverProfile.approvalStatus) }}
              </span>
            </div>
            <div class="text-xs text-slate-500">
              {{ driver.driverProfile.vehiclePlate }} · {{ driver.driverProfile.vehicleMake }} {{ driver.driverProfile.vehicleModel }}
            </div>
          </button>
          <div v-if="!state.loading && state.drivers.length === 0" class="py-10 text-center text-sm text-slate-500">No hay conductores para revisar.</div>
          <div v-if="state.loading" class="py-10 text-center text-sm text-slate-500">Cargando conductores...</div>
        </div>
      </div>

      <div class="rounded-md border border-slate-200 bg-white p-5">
        <template v-if="selectedDriver">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-slate-950">{{ driverName(selectedDriver) }}</h2>
              <p class="mt-1 text-sm text-slate-500">{{ selectedDriver.email }} · {{ selectedDriver.phoneNumber || "Sin teléfono" }}</p>
            </div>
            <span :class="['rounded-full border px-2.5 py-1 text-xs font-semibold', statusClass(selectedDriver.driverProfile.approvalStatus)]">
              {{ statusLabel(selectedDriver.driverProfile.approvalStatus) }}
            </span>
          </div>

          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <div class="rounded-md bg-slate-50 p-4">
              <h3 class="text-sm font-semibold text-slate-950">Información del conductor</h3>
              <dl class="mt-3 grid gap-2 text-sm">
                <div><dt class="text-slate-500">Licencia</dt><dd class="font-medium">{{ selectedDriver.driverProfile.licenseNumber }}</dd></div>
                <div><dt class="text-slate-500">Servicios</dt><dd class="font-medium">{{ selectedDriver.driverProfile.serviceTypes.join(", ") || "-" }}</dd></div>
                <div><dt class="text-slate-500">Registro</dt><dd class="font-medium">{{ new Date(selectedDriver.createdAt).toLocaleString() }}</dd></div>
              </dl>
            </div>
            <div class="rounded-md bg-slate-50 p-4">
              <h3 class="text-sm font-semibold text-slate-950">Vehículo</h3>
              <dl class="mt-3 grid gap-2 text-sm">
                <div><dt class="text-slate-500">Placa</dt><dd class="font-medium">{{ selectedDriver.driverProfile.vehiclePlate }}</dd></div>
                <div><dt class="text-slate-500">Marca / modelo</dt><dd class="font-medium">{{ selectedDriver.driverProfile.vehicleMake }} {{ selectedDriver.driverProfile.vehicleModel }}</dd></div>
                <div><dt class="text-slate-500">Año / color</dt><dd class="font-medium">{{ selectedDriver.driverProfile.vehicleYear || "-" }} · {{ selectedDriver.driverProfile.vehicleColor || "-" }}</dd></div>
              </dl>
            </div>
          </div>

          <div class="mt-4 rounded-md border border-slate-200 p-4">
            <h3 class="text-sm font-semibold text-slate-950">Documentos</h3>
            <div class="mt-3 grid gap-2">
              <div v-for="[key, value] in documentEntries(selectedDriver)" :key="key" class="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span class="font-medium text-slate-700">{{ key }}</span>
                <a v-if="String(value).startsWith('http')" class="text-blue-700 hover:underline" :href="value" target="_blank" rel="noreferrer">Abrir</a>
                <span v-else class="truncate text-slate-500">{{ value }}</span>
              </div>
              <div v-if="documentEntries(selectedDriver).length === 0" class="py-4 text-sm text-slate-500">No hay documentos registrados.</div>
            </div>
          </div>

          <div class="mt-4 grid gap-2">
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Notas de revisión
              <textarea v-model.trim="form.approvalNotes" class="min-h-24 rounded-md border border-slate-300 p-3 text-sm" placeholder="Motivo, observaciones o documentos faltantes"></textarea>
            </label>
          </div>

          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button class="inline-flex h-9 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-60" :disabled="Boolean(state.saving)" type="button" @click="updateApproval('changes_requested')">
              <ShieldAlert class="h-4 w-4" />
              Solicitar cambios
            </button>
            <button class="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60" :disabled="Boolean(state.saving)" type="button" @click="updateApproval('rejected')">
              <XCircle class="h-4 w-4" />
              Rechazar
            </button>
            <button class="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60" :disabled="Boolean(state.saving)" type="button" @click="updateApproval('approved')">
              <CheckCircle2 class="h-4 w-4" />
              Aprobar
            </button>
          </div>
        </template>
        <div v-else class="grid min-h-80 place-items-center text-center text-sm text-slate-500">
          Selecciona un conductor para revisar su información.
        </div>
      </div>
    </div>
  </section>
</template>
