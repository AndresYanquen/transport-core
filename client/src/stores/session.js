import { computed, reactive, readonly } from "vue";

const STORAGE_KEY = "taxi.auth.session";
const AUTH_REQUIRED_EVENT = "taxi:auth-required";

let expiryTimer = null;

const state = reactive({
  initialized: false,
  token: "",
  expiresIn: null,
  expiresAt: null,
  user: null,
});

function decodeTokenExpiryMs(token) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(atob(toBase64(parts[1])));
    if (!payload || typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function toBase64(base64Url) {
  return base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
}

function resolveExpiresAtMs(session) {
  const tokenExpiry = decodeTokenExpiryMs(session?.token);
  if (tokenExpiry) return tokenExpiry;

  const expiresInSeconds = Number(session?.expiresIn);
  if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1000;
  }

  return null;
}

function isExpired() {
  return !!state.expiresAt && Date.now() >= state.expiresAt;
}

function notifyAuthRequired(reason = "required") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason } }));
}

function clearExpiryTimer() {
  if (expiryTimer !== null) {
    window.clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function scheduleExpiryCheck() {
  clearExpiryTimer();

  if (!state.expiresAt || typeof window === "undefined") return;

  const msUntilExpiry = state.expiresAt - Date.now();
  if (msUntilExpiry <= 0) {
    clearSession({ reason: "expired", notify: true });
    return;
  }

  expiryTimer = window.setTimeout(() => {
    clearSession({ reason: "expired", notify: true });
  }, msUntilExpiry);
}

function loadFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    state.token = parsed.token || "";
    state.expiresIn = parsed.expiresIn ?? null;
    state.expiresAt = parsed.expiresAt ?? decodeTokenExpiryMs(parsed.token) ?? null;
    state.user = parsed.user || null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persist() {
  if (!state.token) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      token: state.token,
      expiresIn: state.expiresIn,
      expiresAt: state.expiresAt,
      user: state.user,
    })
  );
}

export function initializeSession() {
  if (state.initialized) return;

  loadFromStorage();
  if (isExpired()) {
    clearSession({ reason: "expired", notify: false });
  } else {
    scheduleExpiryCheck();
  }

  state.initialized = true;
}

export function setSession(session) {
  state.token = session?.token || "";
  state.expiresIn = session?.expiresIn ?? null;
  state.expiresAt = resolveExpiresAtMs(session);
  state.user = session?.user || null;

  persist();

  if (isExpired()) {
    clearSession({ reason: "expired", notify: true });
    return;
  }

  scheduleExpiryCheck();
}

export function clearSession({ reason = "logout", notify = false } = {}) {
  state.token = "";
  state.expiresIn = null;
  state.expiresAt = null;
  state.user = null;

  clearExpiryTimer();
  persist();

  if (notify) {
    notifyAuthRequired(reason);
  }
}

export function requireValidSessionToken() {
  if (!state.token) return "";

  if (isExpired()) {
    clearSession({ reason: "expired", notify: true });
    return "";
  }

  return state.token;
}

export function getSessionToken() {
  return requireValidSessionToken();
}

export function onAuthRequired(handler) {
  if (typeof window === "undefined") return () => {};

  const listener = (event) => {
    const reason = event?.detail?.reason || "required";
    handler(reason);
  };

  window.addEventListener(AUTH_REQUIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
}

export const sessionState = readonly(state);
export const isAuthenticated = computed(() => !!state.token && !isExpired());
export const sessionRole = computed(() => (state.user?.role || "").toLowerCase());
