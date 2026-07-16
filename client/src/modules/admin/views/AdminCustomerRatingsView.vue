<script setup>
import { computed, onMounted, reactive } from "vue";
import { RefreshCw, Search, Star, TrendingUp, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const state = reactive({ loading: true, error: "", users: [], rides: [], lastUpdatedAt: null });
const filters = reactive({ search: "", rating: "all" });

async function fetchRatings() {
  state.loading = true;
  state.error = "";
  try {
    const [usersData, ridesData] = await Promise.all([
      apiRequest("/api/admin/users?role=client&limit=200", { method: "GET" }),
      apiRequest("/api/rides?limit=500&includePassenger=true", { method: "GET" }),
    ]);
    state.users = usersData?.users || [];
    state.rides = ridesData?.rides || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar las calificaciones.";
  } finally {
    state.loading = false;
  }
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function customerName(user) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.email || shortId(user?.id);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function ratingValue(user) {
  return Number(user?.clientProfile?.rating || 0);
}

function formatRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating.toFixed(2) : "Sin calificación";
}

function ratingTone(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return "border-slate-200 bg-slate-50 text-slate-600";
  if (rating >= 4.5) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (rating >= 3.5) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

const ridesByClientId = computed(() => {
  const map = new Map();
  for (const ride of state.rides) {
    if (!ride.clientId) continue;
    map.set(ride.clientId, (map.get(ride.clientId) || 0) + 1);
  }
  return map;
});

const filteredUsers = computed(() => {
  const query = filters.search.trim().toLowerCase();
  return state.users.filter((user) => {
    const rating = ratingValue(user);
    if (filters.rating === "high" && rating < 4.5) return false;
    if (filters.rating === "medium" && (rating < 3.5 || rating >= 4.5)) return false;
    if (filters.rating === "low" && (!rating || rating >= 3.5)) return false;
    if (filters.rating === "unrated" && rating > 0) return false;
    if (!query) return true;
    return [user.id, customerName(user), user.email, user.phoneNumber].filter(Boolean).join(" ").toLowerCase().includes(query);
  });
});

const averageRating = computed(() => {
  const ratings = state.users.map(ratingValue).filter((rating) => rating > 0);
  return ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null;
});

const summary = computed(() => [
  { label: "Clientes", value: state.users.length, icon: Users },
  { label: "Promedio", value: averageRating.value ? averageRating.value.toFixed(2) : "-", icon: Star },
  { label: ">= 4.5", value: state.users.filter((user) => ratingValue(user) >= 4.5).length, icon: TrendingUp },
  { label: "Sin calificación", value: state.users.filter((user) => !ratingValue(user)).length, icon: Star },
]);

onMounted(fetchRatings);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Clientes</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Calificaciones</h1>
        <p class="mt-1 text-sm text-slate-500">Puntaje acumulado por cliente y volumen de servicios.</p>
      </div>
      <button class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60" :disabled="state.loading" type="button" @click="fetchRatings"><RefreshCw class="h-4 w-4" />Actualizar</button>
    </div>
    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{{ state.error }}</div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4">
        <div class="flex items-start justify-between gap-3"><div><div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div><div class="mt-1 text-sm text-slate-500">{{ item.label }}</div></div><div class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white"><component :is="item.icon" class="h-4 w-4" /></div></div>
      </div>
    </div>
    <div class="rounded-md border border-slate-200 bg-white p-4">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 class="text-base font-semibold text-slate-950">Ranking</h2><p class="text-sm text-slate-500">{{ filteredUsers.length }} visibles <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span></p></div>
        <div class="flex flex-wrap gap-2">
          <label class="relative"><Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input v-model.trim="filters.search" class="h-9 w-80 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10" placeholder="Buscar cliente, correo o teléfono" /></label>
          <select v-model="filters.rating" class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"><option value="all">Todas</option><option value="high">Altas (>= 4.5)</option><option value="medium">Medias (3.5 - 4.49)</option><option value="low">Bajas (&lt; 3.5)</option><option value="unrated">Sin calificación</option></select>
        </div>
      </div>
      <div class="overflow-auto">
        <table class="w-full min-w-[860px] border-collapse text-sm">
          <thead><tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><th class="py-2 pr-3">Cliente</th><th class="py-2 pr-3">Calificación</th><th class="py-2 pr-3">Servicios</th><th class="py-2 pr-3">Estado</th><th class="py-2 pr-3">Registro</th></tr></thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pr-3"><div class="font-medium text-slate-950">{{ customerName(user) }}</div><div class="text-xs text-slate-500">{{ user.email || shortId(user.id) }}</div></td>
              <td class="py-3 pr-3"><span :class="['inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold', ratingTone(ratingValue(user))]"><Star class="h-3.5 w-3.5" />{{ formatRating(ratingValue(user)) }}</span></td>
              <td class="py-3 pr-3">{{ ridesByClientId.get(user.id) || 0 }}</td>
              <td class="py-3 pr-3">{{ user.status || "-" }}</td>
              <td class="py-3 pr-3">{{ formatDate(user.createdAt) }}</td>
            </tr>
            <tr v-if="!state.loading && filteredUsers.length === 0"><td class="py-10 text-center text-slate-500" colspan="5">No hay clientes para los filtros actuales.</td></tr>
            <tr v-if="state.loading"><td class="py-10 text-center text-slate-500" colspan="5">Cargando calificaciones...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
