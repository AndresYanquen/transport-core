<script setup>
import { computed, onBeforeUnmount, reactive, shallowRef } from "vue";
import { CheckCircle2, Clipboard, Link, LogOut, Radio, RefreshCw, ShieldCheck, Users, Wifi, XCircle } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const roomRef = shallowRef(null);

const state = reactive({
  loading: false,
  connecting: false,
  disconnecting: false,
  error: "",
  result: null,
  testedAt: null,
  copied: "",
  connectionState: "disconnected",
  roomName: "",
  participantCount: 0,
  connectedAt: null,
});

const livekit = computed(() => state.result?.livekit || null);
const isConnected = computed(() => state.connectionState === "connected");

const tokenPreview = computed(() => {
  const token = livekit.value?.token || "";
  if (!token) return "-";
  return token.length > 36 ? `${token.slice(0, 18)}...${token.slice(-14)}` : token;
});

const tokenPayload = computed(() => {
  const token = livekit.value?.token || "";
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded));
  } catch (_error) {
    return null;
  }
});

const grants = computed(() => tokenPayload.value?.video || null);

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatExpiry(seconds) {
  if (!seconds) return "-";
  return formatDate(seconds * 1000);
}

function updateParticipantCount(room = roomRef.value) {
  state.participantCount = room ? room.remoteParticipants.size + (room.localParticipant ? 1 : 0) : 0;
}

function bindRoomEvents(room) {
  room
    .on(RoomEvent.Connected, () => {
      state.connectionState = "connected";
      state.roomName = room.name || livekit.value?.room || "";
      state.connectedAt = new Date().toISOString();
      updateParticipantCount(room);
    })
    .on(RoomEvent.Disconnected, () => {
      state.connectionState = "disconnected";
      state.participantCount = 0;
    })
    .on(RoomEvent.Reconnecting, () => {
      state.connectionState = "reconnecting";
    })
    .on(RoomEvent.Reconnected, () => {
      state.connectionState = "connected";
      updateParticipantCount(room);
    })
    .on(RoomEvent.ParticipantConnected, () => updateParticipantCount(room))
    .on(RoomEvent.ParticipantDisconnected, () => updateParticipantCount(room));
}

async function fetchLiveKitToken() {
  state.loading = true;
  state.error = "";
  state.copied = "";

  try {
    state.result = await apiRequest("/api/radio/livekit/token-test", { method: "GET" });
    state.testedAt = new Date().toISOString();
  } catch (error) {
    state.result = null;
    state.error = error?.message || "No se pudo obtener el token de prueba.";
  } finally {
    state.loading = false;
  }
}

async function connectLiveKit() {
  state.error = "";

  if (!livekit.value?.url || !livekit.value?.token) {
    await fetchLiveKitToken();
  }

  if (!livekit.value?.url || !livekit.value?.token) return;

  await disconnectLiveKit({ silent: true });

  state.connecting = true;
  state.connectionState = "connecting";

  try {
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    bindRoomEvents(room);
    roomRef.value = room;
    await room.connect(livekit.value.url, livekit.value.token);
    updateParticipantCount(room);
  } catch (error) {
    state.connectionState = "disconnected";
    roomRef.value = null;
    state.error = error?.message || "No se pudo conectar con LiveKit.";
  } finally {
    state.connecting = false;
  }
}

async function disconnectLiveKit({ silent = false } = {}) {
  const room = roomRef.value;
  if (!room) return;

  state.disconnecting = true;
  try {
    await room.disconnect();
  } catch (error) {
    if (!silent) state.error = error?.message || "No se pudo desconectar de LiveKit.";
  } finally {
    room.removeAllListeners();
    roomRef.value = null;
    state.disconnecting = false;
    state.connectionState = "disconnected";
    state.participantCount = 0;
  }
}

async function copyValue(label, value) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  state.copied = label;
  window.setTimeout(() => {
    if (state.copied === label) state.copied = "";
  }, 1800);
}

onBeforeUnmount(() => {
  disconnectLiveKit({ silent: true });
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Operadoras</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Actividad</h1>
        <p class="mt-1 text-sm text-slate-500">Prueba de token y conexión LiveKit para radio.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          :disabled="state.loading || state.connecting"
          type="button"
          @click="fetchLiveKitToken"
        >
          <RefreshCw :class="['h-4 w-4', state.loading ? 'animate-spin' : '']" />
          Obtener token
        </button>
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          :disabled="state.loading || state.connecting || isConnected"
          type="button"
          @click="connectLiveKit"
        >
          <Link :class="['h-4 w-4', state.connecting ? 'animate-pulse' : '']" />
          Conectar
        </button>
        <button
          class="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          :disabled="!roomRef || state.disconnecting"
          type="button"
          @click="disconnectLiveKit()"
        >
          <LogOut class="h-4 w-4" />
          Desconectar
        </button>
      </div>
    </div>

    <div v-if="state.error" class="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <XCircle class="mt-0.5 h-4 w-4 shrink-0" />
      <span>{{ state.error }}</span>
    </div>

    <div class="grid gap-3 md:grid-cols-4">
      <article class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm text-slate-500">Token</div>
            <div class="mt-1 text-xl font-semibold text-slate-950">{{ livekit ? "Emitido" : state.loading ? "Consultando" : "Sin token" }}</div>
          </div>
          <span :class="['grid h-10 w-10 place-items-center rounded-md', livekit ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500']">
            <CheckCircle2 v-if="livekit" class="h-5 w-5" />
            <Wifi v-else class="h-5 w-5" />
          </span>
        </div>
      </article>

      <article class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm text-slate-500">Conexión</div>
            <div class="mt-1 text-xl font-semibold capitalize text-slate-950">{{ state.connectionState }}</div>
          </div>
          <span :class="['grid h-10 w-10 place-items-center rounded-md', isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700']">
            <Wifi class="h-5 w-5" />
          </span>
        </div>
      </article>

      <article class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm text-slate-500">Sala</div>
            <div class="mt-1 truncate text-xl font-semibold text-slate-950">{{ state.roomName || livekit?.room || "-" }}</div>
          </div>
          <span class="grid h-10 w-10 place-items-center rounded-md bg-amber-100 text-amber-700">
            <Radio class="h-5 w-5" />
          </span>
        </div>
      </article>

      <article class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm text-slate-500">Participantes</div>
            <div class="mt-1 text-xl font-semibold text-slate-950">{{ state.participantCount }}</div>
          </div>
          <span class="grid h-10 w-10 place-items-center rounded-md bg-sky-100 text-sky-700">
            <Users class="h-5 w-5" />
          </span>
        </div>
      </article>
    </div>

    <section class="rounded-md border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h2 class="text-base font-semibold text-slate-950">Respuesta LiveKit</h2>
        <p class="mt-1 text-sm text-slate-500">Última prueba: {{ formatDate(state.testedAt) }} · Conectado: {{ formatDate(state.connectedAt) }}</p>
      </div>

      <div class="grid gap-3 p-4 md:grid-cols-2">
        <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-medium uppercase tracking-wide text-slate-500">URL</div>
              <div class="mt-1 truncate font-mono text-sm text-slate-900">{{ livekit?.url || "-" }}</div>
            </div>
            <button class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100" type="button" @click="copyValue('url', livekit?.url)">
              <Clipboard class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Identidad</div>
              <div class="mt-1 truncate font-mono text-sm text-slate-900">{{ livekit?.identity || "-" }}</div>
            </div>
            <button class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100" type="button" @click="copyValue('identity', livekit?.identity)">
              <Clipboard class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div class="rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-2">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Token</div>
              <div class="mt-1 truncate font-mono text-sm text-slate-900">{{ tokenPreview }}</div>
            </div>
            <button class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100" type="button" @click="copyValue('token', livekit?.token)">
              <Clipboard class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div class="grid gap-3 border-t border-slate-200 p-4 text-sm md:grid-cols-4">
        <div>
          <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Expira</div>
          <div class="mt-1 text-slate-900">{{ formatExpiry(tokenPayload?.exp) }}</div>
        </div>
        <div>
          <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Publish</div>
          <div class="mt-1 text-slate-900">{{ grants?.canPublish === undefined ? "-" : grants.canPublish ? "Sí" : "No" }}</div>
        </div>
        <div>
          <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Subscribe</div>
          <div class="mt-1 text-slate-900">{{ grants?.canSubscribe === undefined ? "-" : grants.canSubscribe ? "Sí" : "No" }}</div>
        </div>
        <div>
          <div class="text-xs font-medium uppercase tracking-wide text-slate-500">Copiado</div>
          <div class="mt-1 text-slate-900">{{ state.copied || "-" }}</div>
        </div>
      </div>

      <div class="flex items-start gap-2 border-t border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>Esta prueba valida conexión al room. La publicación de micrófono se deja para el flujo de radio real.</span>
      </div>
    </section>
  </section>
</template>
