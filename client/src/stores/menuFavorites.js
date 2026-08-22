import { computed, reactive } from "vue";
import { apiRequest } from "../services/api.js";

const state = reactive({
  favorites: [],
  availableItems: [],
  loading: false,
  saving: false,
  error: "",
});

function rootPrefixForRole(role) {
  return String(role || "").toLowerCase() === "operator" ? "operator" : "admin";
}

async function fetchFavorites(role) {
  const rootPrefix = rootPrefixForRole(role);
  state.loading = true;
  state.error = "";

  try {
    const result = await apiRequest(`/api/admin/navigation/favorites?rootPrefix=${encodeURIComponent(rootPrefix)}`, {
      method: "GET",
    });
    state.favorites = Array.isArray(result?.favorites) ? result.favorites : [];
    state.availableItems = Array.isArray(result?.availableItems) ? result.availableItems : [];
    return result;
  } catch (error) {
    state.error = error?.message || "No se pudieron cargar favoritos.";
    throw error;
  } finally {
    state.loading = false;
  }
}

async function saveFavorites(role, favoriteCodes) {
  const rootPrefix = rootPrefixForRole(role);
  state.saving = true;
  state.error = "";

  try {
    const result = await apiRequest("/api/admin/navigation/favorites", {
      method: "PUT",
      body: { rootPrefix, favoriteCodes },
    });
    state.favorites = Array.isArray(result?.favorites) ? result.favorites : [];
    state.availableItems = Array.isArray(result?.availableItems) ? result.availableItems : [];
    return result;
  } catch (error) {
    state.error = error?.message || "No se pudieron guardar favoritos.";
    throw error;
  } finally {
    state.saving = false;
  }
}

function resetFavorites() {
  state.favorites = [];
  state.availableItems = [];
  state.loading = false;
  state.saving = false;
  state.error = "";
}

export function useMenuFavoritesStore() {
  const favoriteCodes = computed(() => new Set(state.favorites.map((item) => item.code)));

  return {
    state,
    favoriteCodes,
    fetchFavorites,
    saveFavorites,
    resetFavorites,
  };
}
