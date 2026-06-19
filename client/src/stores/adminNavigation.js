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
    const result = await apiRequest("/api/admin/navigation/menu", { method: "GET" });
    state.items = Array.isArray(result?.items) ? result.items : [];
    state.loaded = true;
    return state.items;
  } catch (err) {
    state.error = err?.message || "Unable to load admin menu.";
    throw err;
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

export function useAdminNavigationStore() {
  return {
    state,
    fetchMenu,
    resetMenu,
  };
}
