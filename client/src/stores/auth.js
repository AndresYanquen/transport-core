import { computed, reactive } from "vue";
import { apiRequest, setAuthToken } from "../services/api.js";

const STORAGE_KEY = "taxi_admin_auth";

const state = reactive({
  token: "",
  user: null,
  initialized: false,
  loading: false,
  error: "",
});

function readStoredSession() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  if (typeof window === "undefined") return;

  if (!session?.token) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      token: session.token,
      user: session.user || null,
    }),
  );
}

function applySession(session) {
  state.token = session?.token || "";
  state.user = session?.user || null;
  setAuthToken(state.token);
  writeStoredSession(session);
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.error = "";
  setAuthToken("");
  writeStoredSession(null);
}

async function login({ email, password, rememberMe }) {
  state.loading = true;
  state.error = "";

  try {
    const session = await apiRequest("/api/auth/login", {
      method: "POST",
      body: {
        email,
        password,
        rememberMe: Boolean(rememberMe),
      },
    });

    applySession(session);
    state.initialized = true;
    return session;
  } catch (err) {
    clearSession();
    state.error = err?.message || "Unable to sign in.";
    throw err;
  } finally {
    state.loading = false;
  }
}

async function restore() {
  if (state.initialized) return state.user;

  const stored = readStoredSession();
  if (!stored?.token) {
    state.initialized = true;
    return null;
  }

  state.loading = true;
  state.error = "";
  state.token = stored.token;
  state.user = stored.user || null;
  setAuthToken(stored.token);

  try {
    const result = await apiRequest("/api/auth/me", { method: "GET" });
    applySession({
      token: stored.token,
      user: result?.user || null,
    });
    return state.user;
  } catch {
    clearSession();
    return null;
  } finally {
    state.initialized = true;
    state.loading = false;
  }
}

function logout() {
  clearSession();
  state.initialized = true;
}

export function useAuthStore() {
  const isAuthenticated = computed(() => Boolean(state.token && state.user));
  const isAdmin = computed(() => String(state.user?.role || "").toLowerCase() === "admin");
  const isOperator = computed(() => String(state.user?.role || "").toLowerCase() === "operator");

  return {
    state,
    isAuthenticated,
    isAdmin,
    isOperator,
    login,
    logout,
    restore,
  };
}
