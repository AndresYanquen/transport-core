<script setup>
import { computed, onMounted, reactive } from "vue";
import { RefreshCw, Save, SlidersHorizontal } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const state = reactive({
  loading: true,
  saving: false,
  error: "",
  success: "",
  settings: {},
});

const form = reactive({
  clientDriverSearchRadiusMeters: "",
  driverRequestSearchRadiusMeters: "",
});

const canSave = computed(() => {
  return (
    isValidRadius(form.clientDriverSearchRadiusMeters) &&
    isValidRadius(form.driverRequestSearchRadiusMeters) &&
    !state.saving
  );
});

function isValidRadius(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 100 && n <= 100000;
}

function metersToKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n / 1000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} km`;
}

function applySettings(settings) {
  state.settings = settings || {};
  form.clientDriverSearchRadiusMeters =
    state.settings.client_driver_search_radius_meters?.value || "";
  form.driverRequestSearchRadiusMeters =
    state.settings.driver_request_search_radius_meters?.value || "";
}

async function fetchParameters() {
  state.loading = true;
  state.error = "";
  state.success = "";

  try {
    const result = await apiRequest("/api/admin/operational-parameters", {
      method: "GET",
    });
    applySettings(result?.settings);
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar los parámetros.";
  } finally {
    state.loading = false;
  }
}

async function saveParameters() {
  if (!canSave.value) return;
  state.saving = true;
  state.error = "";
  state.success = "";

  try {
    const result = await apiRequest("/api/admin/operational-parameters", {
      method: "PATCH",
      body: {
        settings: {
          client_driver_search_radius_meters: Number(form.clientDriverSearchRadiusMeters),
          driver_request_search_radius_meters: Number(form.driverRequestSearchRadiusMeters),
        },
      },
    });

    applySettings({
      ...state.settings,
      ...result?.settings,
    });
    state.success = "Parámetros operativos actualizados.";
  } catch (err) {
    state.error = err?.message || "No se pudieron guardar los parámetros.";
  } finally {
    state.saving = false;
  }
}

onMounted(fetchParameters);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Configuración</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Parámetros Operativos</h1>
        <p class="mt-1 text-sm text-slate-500">Radios de búsqueda usados por matching y asignación.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        :disabled="state.loading"
        type="button"
        @click="fetchParameters"
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

    <form class="max-w-3xl rounded-md border border-slate-200 bg-white p-5" @submit.prevent="saveParameters">
      <div class="mb-5 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-md bg-slate-950 text-white">
          <SlidersHorizontal class="h-5 w-5" />
        </div>
        <div>
          <h2 class="text-base font-semibold text-slate-950">Radios de búsqueda</h2>
          <p class="text-sm text-slate-500">Valores en metros. Rango permitido: 100 a 100000.</p>
        </div>
      </div>

      <div class="grid gap-4">
        <label class="grid gap-1.5 text-sm font-medium text-slate-700">
          Radio cliente → conductores disponibles
          <div class="flex gap-2">
            <input
              v-model="form.clientDriverSearchRadiusMeters"
              class="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              min="100"
              max="100000"
              step="100"
              type="number"
            />
            <div class="grid h-10 min-w-24 place-items-center rounded-md bg-slate-100 px-3 text-sm text-slate-700">
              {{ metersToKm(form.clientDriverSearchRadiusMeters) }}
            </div>
          </div>
          <span class="text-xs font-normal text-slate-500">
            {{ state.settings.client_driver_search_radius_meters?.description }}
          </span>
        </label>

        <label class="grid gap-1.5 text-sm font-medium text-slate-700">
          Radio conductor → solicitudes pendientes
          <div class="flex gap-2">
            <input
              v-model="form.driverRequestSearchRadiusMeters"
              class="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              min="100"
              max="100000"
              step="100"
              type="number"
            />
            <div class="grid h-10 min-w-24 place-items-center rounded-md bg-slate-100 px-3 text-sm text-slate-700">
              {{ metersToKm(form.driverRequestSearchRadiusMeters) }}
            </div>
          </div>
          <span class="text-xs font-normal text-slate-500">
            {{ state.settings.driver_request_search_radius_meters?.description }}
          </span>
        </label>
      </div>

      <div class="mt-5 flex justify-end">
        <button
          class="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="!canSave"
          type="submit"
        >
          <Save class="h-4 w-4" />
          {{ state.saving ? "Guardando..." : "Guardar cambios" }}
        </button>
      </div>
    </form>
  </section>
</template>
