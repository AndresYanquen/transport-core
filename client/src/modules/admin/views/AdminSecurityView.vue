<script setup>
import { computed, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { History, KeyRound, RefreshCw, Search, ShieldCheck, Users } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";

const route = useRoute();
const router = useRouter();

const tabs = [
  { key: "roles", label: "Roles", icon: Users },
  { key: "permissions", label: "Permisos", icon: KeyRound },
  { key: "audit", label: "Auditoría", icon: History },
];

const roleLabels = {
  admin: "Administrador",
  operator: "Operadora",
  client: "Cliente",
  driver: "Conductor",
};

const sourceLabels = {
  ride: "Servicio",
  radio: "Radio",
};

const tabAliases = {
  permisos: "permissions",
  auditoria: "audit",
};

const state = reactive({
  loading: false,
  error: "",
  roles: [],
  permissions: [],
  events: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
});

const activeTab = computed(() => {
  const rawKey = String(route.params.securityView || "roles");
  const key = tabAliases[rawKey] || rawKey;
  return tabs.some((tab) => tab.key === key) ? key : "roles";
});

const activeTabMeta = computed(() => tabs.find((tab) => tab.key === activeTab.value) || tabs[0]);

const filteredRoles = computed(() => {
  const query = filters.search.trim().toLowerCase();
  if (!query) return state.roles;
  return state.roles.filter((role) => [
    role.role,
    roleLabels[role.role],
    ...(role.permissions || []).map((permission) => `${permission.code} ${permission.name}`),
  ].filter(Boolean).join(" ").toLowerCase().includes(query));
});

const filteredPermissions = computed(() => {
  const query = filters.search.trim().toLowerCase();
  if (!query) return state.permissions;
  return state.permissions.filter((permission) => [
    permission.code,
    permission.name,
    permission.description,
  ].filter(Boolean).join(" ").toLowerCase().includes(query));
});

const filteredEvents = computed(() => {
  const query = filters.search.trim().toLowerCase();
  if (!query) return state.events;
  return state.events.filter((event) => [
    event.source,
    event.entityId,
    event.eventType,
    event.actorId,
    event.actorRole,
  ].filter(Boolean).join(" ").toLowerCase().includes(query));
});

const summary = computed(() => [
  { label: "Roles", value: state.roles.length, icon: Users },
  { label: "Permisos", value: state.permissions.length, icon: KeyRound },
  { label: "Eventos auditados", value: state.events.length, icon: History },
]);

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function shortId(value) {
  if (!value) return "-";
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function openTab(key) {
  router.replace(`/admin/seguridad/${key}`);
}

async function fetchSecurity() {
  state.loading = true;
  state.error = "";

  try {
    const [rolesData, permissionsData, auditData] = await Promise.all([
      apiRequest("/api/admin/security/roles", { method: "GET" }),
      apiRequest("/api/admin/security/permissions", { method: "GET" }),
      apiRequest("/api/admin/security/audit?limit=100", { method: "GET" }),
    ]);
    state.roles = rolesData?.roles || [];
    state.permissions = permissionsData?.permissions || [];
    state.events = auditData?.events || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (error) {
    state.error = error?.message || "No se pudo cargar seguridad.";
  } finally {
    state.loading = false;
  }
}

watch(activeTab, () => {
  filters.search = "";
});

onMounted(fetchSecurity);
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Seguridad</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">{{ activeTabMeta.label }}</h1>
        <p class="mt-1 text-sm text-slate-500">Roles, permisos y trazabilidad operativa del sistema.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchSecurity"
      >
        <RefreshCw :class="['h-4 w-4', state.loading ? 'animate-spin' : '']" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <article v-for="item in summary" :key="item.label" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : item.value }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ item.label }}</div>
          </div>
          <span class="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
            <component :is="item.icon" class="h-4 w-4" />
          </span>
        </div>
      </article>
    </div>

    <section class="rounded-md border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="[
              'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium',
              activeTab === tab.key ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ]"
            type="button"
            @click="openTab(tab.key)"
          >
            <component :is="tab.icon" class="h-4 w-4" />
            {{ tab.label }}
          </button>
        </div>
        <label class="relative">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            v-model.trim="filters.search"
            class="h-9 w-72 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400"
            placeholder="Buscar"
            type="search"
          />
        </label>
      </div>

      <div v-if="activeTab === 'roles'" class="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <article v-for="role in filteredRoles" :key="role.role" class="rounded-md border border-slate-200 p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-slate-950">{{ roleLabels[role.role] || role.role }}</h2>
              <p class="mt-1 font-mono text-xs text-slate-500">{{ role.role }}</p>
            </div>
            <ShieldCheck class="h-5 w-5 text-slate-500" />
          </div>
          <div class="mt-4 text-sm font-medium text-slate-700">{{ role.permissions.length }} permisos</div>
          <div class="mt-2 grid gap-1">
            <span
              v-for="permission in role.permissions.slice(0, 8)"
              :key="permission.code"
              class="truncate rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600"
            >
              {{ permission.name || permission.code }}
            </span>
          </div>
        </article>
      </div>

      <div v-else-if="activeTab === 'permissions'" class="overflow-x-auto">
        <table class="w-full min-w-[860px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Permiso</th>
              <th class="px-4 py-3">Código</th>
              <th class="px-4 py-3">Descripción</th>
              <th class="px-4 py-3">Actualizado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="permission in filteredPermissions" :key="permission.code" class="border-b border-slate-100">
              <td class="px-4 py-3 font-medium text-slate-950">{{ permission.name }}</td>
              <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ permission.code }}</td>
              <td class="px-4 py-3 text-slate-600">{{ permission.description || "-" }}</td>
              <td class="px-4 py-3 text-slate-500">{{ formatDate(permission.updatedAt || permission.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[980px] text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-4 py-3">Fecha</th>
              <th class="px-4 py-3">Fuente</th>
              <th class="px-4 py-3">Evento</th>
              <th class="px-4 py-3">Entidad</th>
              <th class="px-4 py-3">Actor</th>
              <th class="px-4 py-3">Metadata</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in filteredEvents" :key="`${event.source}-${event.id}`" class="border-b border-slate-100">
              <td class="px-4 py-3 text-slate-600">{{ formatDate(event.occurredAt) }}</td>
              <td class="px-4 py-3">{{ sourceLabels[event.source] || event.source }}</td>
              <td class="px-4 py-3 font-medium text-slate-950">{{ event.eventType }}</td>
              <td class="px-4 py-3 font-mono text-xs text-slate-600">{{ shortId(event.entityId) }}</td>
              <td class="px-4 py-3">
                <div class="text-slate-700">{{ event.actorRole || "-" }}</div>
                <div class="font-mono text-xs text-slate-500">{{ shortId(event.actorId) }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-slate-500">{{ JSON.stringify(event.metadata || {}) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="!state.loading && ((activeTab === 'roles' && !filteredRoles.length) || (activeTab === 'permissions' && !filteredPermissions.length) || (activeTab === 'audit' && !filteredEvents.length))"
        class="py-10 text-center text-sm text-slate-500"
      >
        Sin resultados para los filtros actuales.
      </div>
    </section>
  </section>
</template>
