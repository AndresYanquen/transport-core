import { computed, reactive } from "vue";
import { apiRequest } from "../services/api.js";

const defaults = {
  cityName: "Tunja",
  regionName: "Boyaca",
  countryName: "Colombia",
  countryCode: "CO",
  timezone: "America/Bogota",
  defaultLocale: "es-CO",
  defaultCurrency: "COP",
  defaultPhoneCountry: "CO",
  map: {
    center: { lat: 5.5353, lng: -73.3678 },
    defaultZoom: 13,
  },
  places: {
    searchSuffix: "Tunja, Boyaca, Colombia",
    countryBias: "co",
    searchRadiusMeters: 50000,
  },
};

const state = reactive({
  loading: false,
  loaded: false,
  error: "",
  settings: { ...defaults, map: { ...defaults.map, center: { ...defaults.map.center } }, places: { ...defaults.places } },
});

function mergeSettings(settings = {}) {
  return {
    ...defaults,
    ...settings,
    map: {
      ...defaults.map,
      ...(settings.map || {}),
      center: {
        ...defaults.map.center,
        ...(settings.map?.center || {}),
      },
    },
    places: {
      ...defaults.places,
      ...(settings.places || {}),
    },
  };
}

async function fetchOperationalSettings({ force = false } = {}) {
  if (state.loading) return state.settings;
  if (state.loaded && !force) return state.settings;

  state.loading = true;
  state.error = "";

  try {
    const result = await apiRequest("/api/settings/operational", { method: "GET" });
    state.settings = mergeSettings(result?.settings);
    state.loaded = true;
  } catch (err) {
    state.error = err?.message || "No se pudo cargar la configuración operativa.";
    state.settings = mergeSettings(state.settings);
  } finally {
    state.loading = false;
  }

  return state.settings;
}

export function useOperationalSettings() {
  const settings = computed(() => state.settings);
  const mapCenter = computed(() => state.settings.map.center);
  const mapDefaultZoom = computed(() => state.settings.map.defaultZoom);

  function formatLocalPlaceQuery(query) {
    const value = String(query || "").trim();
    const suffix = state.settings.places.searchSuffix;
    const city = state.settings.cityName;
    if (!value || !suffix) return value;
    return city && value.toLowerCase().includes(city.toLowerCase()) ? value : `${value}, ${suffix}`;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat(state.settings.defaultLocale, {
      style: "currency",
      currency: state.settings.defaultCurrency,
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  return {
    state,
    settings,
    mapCenter,
    mapDefaultZoom,
    fetchOperationalSettings,
    formatLocalPlaceQuery,
    formatCurrency,
  };
}
