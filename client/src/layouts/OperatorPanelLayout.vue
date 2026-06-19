<script setup>
import {
  Bell,
  Car,
  ChevronDown,
  Headset,
  LayoutDashboard,
  Map,
  Menu,
  RadioTower,
  TriangleAlert,
  UserCheck,
  Users,
  X,
} from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { useOperatorNavigationStore } from "../stores/operatorNavigation.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const navigation = useOperatorNavigationStore();
const sidebarOpen = ref(false);
const sidebarCollapsed = ref(false);
const expanded = ref(new Set());

const iconMap = {
  bell: Bell,
  car: Car,
  "layout-dashboard": LayoutDashboard,
  map: Map,
  "radio-tower": RadioTower,
  "triangle-alert": TriangleAlert,
  "user-check": UserCheck,
  users: Users,
};

const activeRoot = computed(() =>
  navigation.state.items.find((item) =>
    item.path && (route.path === item.path || route.path.startsWith(`${item.path}/`)),
  ) || navigation.state.items[0] || null,
);

function iconFor(item) {
  return iconMap[item?.icon] || LayoutDashboard;
}

function isActive(item) {
  return Boolean(item?.path) &&
    (route.path === item.path || route.path.startsWith(`${item.path}/`));
}

function toggle(code) {
  const next = new Set(expanded.value);
  next.has(code) ? next.delete(code) : next.add(code);
  expanded.value = next;
}

function toggleDesktopSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function displayName() {
  return [auth.state.user?.firstName, auth.state.user?.lastName].filter(Boolean).join(" ")
    || auth.state.user?.email
    || "Operadora";
}

async function logout() {
  auth.logout();
  navigation.resetMenu();
  await router.replace({ name: "operator-login" });
}

onMounted(async () => {
  const items = await navigation.fetchMenu().catch(() => []);
  const current = items.find((item) => isActive(item));
  if (current) expanded.value = new Set([current.code]);
});
</script>

<template>
  <div class="min-h-screen bg-slate-100 text-slate-950">
    <button
      v-if="sidebarOpen"
      aria-label="Cerrar menú"
      class="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
      type="button"
      @click="sidebarOpen = false"
    />

    <aside
      :class="[
        'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200',
        sidebarCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div class="flex h-14 items-center justify-between border-b border-slate-200 px-4">
        <RouterLink class="flex items-center gap-2 font-semibold" to="/operator">
          <span class="grid h-8 w-8 place-items-center rounded-md bg-emerald-600 text-white">
            <Headset class="h-4 w-4" />
          </span>
          Centro de Operaciones
        </RouterLink>
        <button class="grid h-8 w-8 place-items-center lg:hidden" type="button" @click="sidebarOpen = false">
          <X class="h-4 w-4" />
        </button>
      </div>

      <nav class="min-h-0 flex-1 overflow-y-auto p-3">
        <p v-if="navigation.state.loading" class="px-2 py-3 text-sm text-slate-500">Cargando menú...</p>
        <div v-else-if="navigation.state.error" class="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {{ navigation.state.error }}
        </div>
        <div v-else-if="!navigation.state.items.length" class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No hay opciones de menú configuradas para este rol.
        </div>

        <div v-else class="grid gap-1">
          <div v-for="item in navigation.state.items" :key="item.code">
            <div class="flex gap-1">
              <RouterLink
                :class="[
                  'flex h-10 min-w-0 flex-1 items-center gap-3 rounded-md px-3 text-sm font-medium transition',
                  isActive(item) ? 'bg-emerald-600 text-white' : 'text-slate-700 hover:bg-slate-100',
                ]"
                :to="item.path || '/operator'"
                @click="sidebarOpen = false"
              >
                <component :is="iconFor(item)" class="h-4 w-4 shrink-0" />
                <span class="truncate">{{ item.label }}</span>
              </RouterLink>
              <button
                v-if="item.children?.length"
                :aria-label="`Alternar opciones de ${item.label}`"
                class="grid h-10 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100"
                type="button"
                @click="toggle(item.code)"
              >
                <ChevronDown :class="['h-4 w-4 transition', expanded.has(item.code) ? 'rotate-180' : '']" />
              </button>
            </div>

            <div v-if="item.children?.length && expanded.has(item.code)" class="ml-5 mt-1 grid gap-1 border-l border-slate-200 pl-3">
              <RouterLink
                v-for="child in item.children"
                :key="child.code"
                :class="[
                  'rounded-md px-3 py-2 text-sm transition',
                  route.path === child.path ? 'bg-emerald-50 font-medium text-emerald-800' : 'text-slate-600 hover:bg-slate-100',
                ]"
                :to="child.path || item.path"
                @click="sidebarOpen = false"
              >
                {{ child.label }}
              </RouterLink>
            </div>
          </div>
        </div>
      </nav>

      <div class="border-t border-slate-200 p-3">
        <div class="rounded-md bg-slate-50 p-3">
          <div class="truncate text-sm font-medium">{{ displayName() }}</div>
          <div class="truncate text-xs text-slate-500">{{ auth.state.user?.email }}</div>
          <button class="mt-3 h-8 w-full rounded-md border border-slate-200 bg-white text-sm" type="button" @click="logout">
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>

    <div :class="['transition-[padding] duration-200', sidebarCollapsed ? 'lg:pl-0' : 'lg:pl-72']">
      <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
        <button class="grid h-9 w-9 place-items-center rounded-md border border-slate-200 lg:hidden" type="button" @click="sidebarOpen = true">
          <Menu class="h-4 w-4" />
        </button>
        <button
          :aria-label="sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'"
          :title="sidebarCollapsed ? 'Expandir menú' : 'Contraer menú'"
          class="hidden h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 lg:grid"
          type="button"
          @click="toggleDesktopSidebar"
        >
          <Menu class="h-4 w-4" />
        </button>
        <div>
          <div class="text-sm font-semibold">{{ activeRoot?.label || "Operación" }}</div>
          <div class="text-xs text-slate-500">{{ route.path }}</div>
        </div>
      </header>
      <main class="min-h-[calc(100vh-56px)]"><RouterView /></main>
    </div>
  </div>
</template>
