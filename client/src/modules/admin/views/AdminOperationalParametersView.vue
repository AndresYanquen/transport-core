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
  cityName: "",
  regionName: "",
  countryName: "",
  countryCode: "",
  timezone: "",
  defaultLocale: "",
  defaultCurrency: "",
  defaultPhoneCountry: "",
  mapCenterLat: "",
  mapCenterLng: "",
  mapDefaultZoom: "",
  placesSearchSuffix: "",
  placesCountryBias: "",
  placesSearchRadiusMeters: "",
});

const canSave = computed(() => {
  return (
    isValidRadius(form.clientDriverSearchRadiusMeters) &&
    isValidRadius(form.driverRequestSearchRadiusMeters) &&
    isText(form.cityName) &&
    isText(form.regionName) &&
    isText(form.countryName) &&
    /^[A-Z]{2}$/.test(form.countryCode.toUpperCase()) &&
    isText(form.timezone) &&
    /^[a-z]{2,3}(-[A-Z]{2})?$/.test(form.defaultLocale) &&
    /^[A-Z]{3}$/.test(form.defaultCurrency.toUpperCase()) &&
    /^[A-Z]{2}$/.test(form.defaultPhoneCountry.toUpperCase()) &&
    isNumberBetween(form.mapCenterLat, -90, 90) &&
    isNumberBetween(form.mapCenterLng, -180, 180) &&
    isNumberBetween(form.mapDefaultZoom, 1, 20, true) &&
    isText(form.placesSearchSuffix) &&
    /^[a-z]{2}$/.test(form.placesCountryBias.toLowerCase()) &&
    isNumberBetween(form.placesSearchRadiusMeters, 1000, 100000, true) &&
    !state.saving
  );
});

function isText(value) {
  return String(value || "").trim().length > 0;
}

function isNumberBetween(value, min, max, integer = false) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
}

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
  form.cityName = state.settings.operational_city_name?.value || "";
  form.regionName = state.settings.operational_region_name?.value || "";
  form.countryName = state.settings.operational_country_name?.value || "";
  form.countryCode = state.settings.operational_country_code?.value || "";
  form.timezone = state.settings.operational_timezone?.value || "";
  form.defaultLocale = state.settings.operational_default_locale?.value || "";
  form.defaultCurrency = state.settings.operational_default_currency?.value || "";
  form.defaultPhoneCountry = state.settings.operational_default_phone_country?.value || "";
  form.mapCenterLat = state.settings.operational_map_center_lat?.value || "";
  form.mapCenterLng = state.settings.operational_map_center_lng?.value || "";
  form.mapDefaultZoom = state.settings.operational_map_default_zoom?.value || "";
  form.placesSearchSuffix = state.settings.operational_places_search_suffix?.value || "";
  form.placesCountryBias = state.settings.operational_places_country_bias?.value || "";
  form.placesSearchRadiusMeters = state.settings.operational_places_search_radius_meters?.value || "";
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
          operational_city_name: form.cityName,
          operational_region_name: form.regionName,
          operational_country_name: form.countryName,
          operational_country_code: form.countryCode.toUpperCase(),
          operational_timezone: form.timezone,
          operational_default_locale: form.defaultLocale,
          operational_default_currency: form.defaultCurrency.toUpperCase(),
          operational_default_phone_country: form.defaultPhoneCountry.toUpperCase(),
          operational_map_center_lat: Number(form.mapCenterLat),
          operational_map_center_lng: Number(form.mapCenterLng),
          operational_map_default_zoom: Number(form.mapDefaultZoom),
          operational_places_search_suffix: form.placesSearchSuffix,
          operational_places_country_bias: form.placesCountryBias.toLowerCase(),
          operational_places_search_radius_meters: Number(form.placesSearchRadiusMeters),
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
        <p class="mt-1 text-sm text-slate-500">Ciudad, mapas, moneda y radios usados por la operación.</p>
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
          <h2 class="text-base font-semibold text-slate-950">Configuración de ciudad</h2>
          <p class="text-sm text-slate-500">Estos valores reemplazan los defaults quemados en código.</p>
        </div>
      </div>

      <div class="grid gap-5">
        <div class="grid gap-4 md:grid-cols-3">
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Ciudad
            <input v-model.trim="form.cityName" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Región/departamento
            <input v-model.trim="form.regionName" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            País
            <input v-model.trim="form.countryName" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
          </label>
        </div>

        <div class="grid gap-4 md:grid-cols-4">
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Código país
            <input v-model.trim="form.countryCode" class="h-10 rounded-md border border-slate-300 px-3 text-sm uppercase" maxlength="2" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Moneda
            <input v-model.trim="form.defaultCurrency" class="h-10 rounded-md border border-slate-300 px-3 text-sm uppercase" maxlength="3" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Locale
            <input v-model.trim="form.defaultLocale" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Teléfono país
            <input v-model.trim="form.defaultPhoneCountry" class="h-10 rounded-md border border-slate-300 px-3 text-sm uppercase" maxlength="2" />
          </label>
        </div>

        <label class="grid gap-1.5 text-sm font-medium text-slate-700">
          Zona horaria
          <input v-model.trim="form.timezone" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
        </label>

        <div class="grid gap-4 md:grid-cols-3">
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Latitud centro mapa
            <input v-model="form.mapCenterLat" class="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" step="0.000001" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Longitud centro mapa
            <input v-model="form.mapCenterLng" class="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" step="0.000001" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Zoom mapa
            <input v-model="form.mapDefaultZoom" class="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" min="1" max="20" step="1" />
          </label>
        </div>

        <div class="grid gap-4 md:grid-cols-[1fr_120px_180px]">
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Sufijo búsqueda direcciones
            <input v-model.trim="form.placesSearchSuffix" class="h-10 rounded-md border border-slate-300 px-3 text-sm" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Bias país
            <input v-model.trim="form.placesCountryBias" class="h-10 rounded-md border border-slate-300 px-3 text-sm lowercase" maxlength="2" />
          </label>
          <label class="grid gap-1.5 text-sm font-medium text-slate-700">
            Radio Places
            <input v-model="form.placesSearchRadiusMeters" class="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" min="1000" max="100000" step="1000" />
          </label>
        </div>

        <div class="border-t border-slate-200 pt-5">
          <h3 class="text-sm font-semibold text-slate-950">Radios de búsqueda</h3>
          <p class="mt-1 text-sm text-slate-500">Valores en metros. Rango permitido: 100 a 100000.</p>
        </div>

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
