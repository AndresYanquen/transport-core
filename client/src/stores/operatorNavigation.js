import { reactive } from "vue";
import { apiRequest } from "../services/api.js";

const state = reactive({
  items: [],
  loading: false,
  loaded: false,
  error: "",
});

async function fetchMenu({ force = false } = {}) {
  if (state.loading || (state.loaded && !force)) return state.items;

  state.loading = true;
  state.error = "";

  try {
    const result = await apiRequest("/api/admin/navigation/operator-menu", {
      method: "GET",
    });
    state.items = Array.isArray(result?.items) ? result.items : [];
    state.loaded = true;
    return state.items;
  } catch (error) {
    state.error = error?.message || "No se pudo cargar el menú de operación.";
    throw error;
  } finally {
    state.loading = false;
  }
}

function resetMenu() {
  state.items = [];
  state.loading = false;
  state.loaded = false;
  state.error = "";
}

export function useOperatorNavigationStore() {
  return { state, fetchMenu, resetMenu };
}
