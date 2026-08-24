<script setup>
import {
  Activity,
  Bell,
  BriefcaseBusiness,
  Car,
  ChartColumn,
  ChevronDown,
  Headset,
  LayoutDashboard,
  Map,
  Menu,
  RadioTower,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import goTaxiLogo from "../assets/images/logo/gottaxi.png";
import MenuFavorites from "../components/MenuFavorites.vue";
import { useAdminNavigationStore } from "../stores/adminNavigation.js";
import { useAuthStore } from "../stores/auth.js";
import { useDriverNotificationsStore } from "../stores/driverNotifications.js";
import { useMenuFavoritesStore } from "../stores/menuFavorites.js";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const navigation = useAdminNavigationStore();
const driverNotifications = useDriverNotificationsStore();
const menuFavorites = useMenuFavoritesStore();
const sidebarOpen = ref(false);
const sidebarCollapsed = ref(false);
const openMenuCode = ref("");

const iconMap = {
  activity: Activity,
  bell: Bell,
  "briefcase-business": BriefcaseBusiness,
  car: Car,
  "chart-column": ChartColumn,
  headset: Headset,
  "layout-dashboard": LayoutDashboard,
  map: Map,
  "radio-tower": RadioTower,
  settings: Settings,
  "shield-check": ShieldCheck,
  users: Users,
};

const activeRootCode = computed(() => {
  const match = navigation.state.items.find((item) => isMenuItemActive(item));
  return match?.code || "dashboard";
});

const activeRoot = computed(() => {
  return navigation.state.items.find((item) => item.code === activeRootCode.value) || navigation.state.items[0] || null;
});

function iconFor(item) {
  return iconMap[item?.icon] || LayoutDashboard;
}

function isMenuItemActive(item) {
  if (!item?.path) return false;
  const path = route.path;
  const selfActive = path === item.path || path.startsWith(`${item.path}/`);
  const childActive = (item.children || []).some((child) => isMenuItemActive(child));
  return selfActive || childActive;
}

function toggleDesktopSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  openMenuCode.value = "";
}

function openFlyout(code) {
  openMenuCode.value = code;
}

function closeFlyout() {
  openMenuCode.value = "";
}

function closeMenus() {
  sidebarOpen.value = false;
  closeFlyout();
}

function handleRootMenuClick(item, event) {
  if (!item?.children?.length) {
    closeMenus();
    return;
  }

  if (item.code === activeRootCode.value) {
    event.preventDefault();
    openFlyout(item.code);
    return;
  }

  closeMenus();
}

function userDisplayName(user) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.email || "Admin";
}

async function logout() {
  auth.logout();
  navigation.resetMenu();
  driverNotifications.resetDriverNotifications();
  menuFavorites.resetFavorites();
  await router.replace({ name: "admin-login" });
}

onMounted(() => {
  navigation.fetchMenu().catch(() => {});
  driverNotifications.refreshUnreadPanicCount().catch(() => {});
  driverNotifications.connectDriverNotifications(auth.state.token);
});
</script>

<template>
  <div class="min-h-screen bg-slate-100 text-slate-950">
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
      @click="sidebarOpen = false"
    ></div>

    <aside
      :class="[
        'fixed inset-y-0 left-0 z-[1300] flex w-72 flex-col border-r border-slate-200 bg-white transition-[transform,width] duration-200',
        sidebarCollapsed ? 'lg:w-16' : 'lg:w-72',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ]"
    >
      <div :class="['flex h-14 items-center justify-between border-b border-slate-200 px-4', sidebarCollapsed ? 'lg:justify-center lg:px-2' : '']">
        <RouterLink class="flex min-w-0 items-center gap-2 font-semibold" to="/">
          <img class="h-9 w-14 shrink-0 rounded-md object-contain object-center" :src="goTaxiLogo" alt="" />
          <span :class="['truncate', sidebarCollapsed ? 'lg:hidden' : '']">Admin Panel</span>
        </RouterLink>
        <button
          class="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-600 lg:hidden"
          type="button"
          @click="sidebarOpen = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <nav :class="['min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 lg:overflow-visible', sidebarCollapsed ? 'lg:px-2' : '']">
        <div v-if="navigation.state.loading" class="px-2 py-3 text-sm text-slate-500">Cargando menú...</div>
        <div v-else-if="navigation.state.error" class="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {{ navigation.state.error }}
        </div>

        <div v-else class="grid gap-1">
          <div
            v-for="item in navigation.state.items"
            :key="item.code"
            class="group/menu relative"
            @focusin="openFlyout(item.code)"
            @mouseenter="openFlyout(item.code)"
            @mouseleave="closeFlyout"
          >
            <RouterLink
              :class="[
                'group flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium transition',
                sidebarCollapsed ? 'lg:justify-center lg:px-0' : '',
                item.code === activeRootCode
                  ? 'bg-slate-950 !text-white shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950',
              ]"
              :to="item.path || '/'"
              @click="handleRootMenuClick(item, $event)"
            >
              <component
                :is="iconFor(item)"
                :class="[
                  'h-4 w-4 transition-colors',
                  item.code === activeRootCode ? 'text-white' : 'text-slate-500 group-hover:text-slate-950',
                ]"
              />
              <span
                :class="[
                  'min-w-0 flex-1 truncate transition-colors',
                  sidebarCollapsed ? 'lg:hidden' : '',
                  item.code === activeRootCode ? 'text-white' : 'text-slate-700 group-hover:text-slate-950',
                ]"
              >
                {{ item.label }}
              </span>
              <ChevronDown
                v-if="item.children?.length"
                :class="[
                  'h-3.5 w-3.5 -rotate-90 transition-colors',
                  sidebarCollapsed ? 'lg:hidden' : '',
                  item.code === activeRootCode ? 'text-white' : 'text-slate-400 group-hover:text-slate-600',
                ]"
              />
            </RouterLink>

            <div
              v-if="item.children?.length"
              :class="[
                'absolute left-0 top-full z-[1400] max-h-[70vh] w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-xl transition lg:left-full lg:top-0 lg:w-72',
                openMenuCode === item.code ? 'visible opacity-100' : 'invisible opacity-0',
              ]"
            >
              <div class="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                {{ item.label }}
              </div>

              <div class="grid gap-1">
                <div v-for="child in item.children" :key="child.code">
                  <RouterLink
                    :class="[
                      'flex min-h-8 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition',
                      isMenuItemActive(child)
                        ? 'bg-slate-950 !text-white'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950',
                    ]"
                    :to="child.path || item.path || '/'"
                    @click="closeMenus"
                  >
                    <span
                      :class="[
                        'min-w-0 truncate',
                        isMenuItemActive(child) ? 'text-white' : 'text-slate-700',
                      ]"
                    >
                      {{ child.label }}
                    </span>
                    <ChevronDown
                      v-if="child.children?.length"
                      :class="[
                        'h-3.5 w-3.5 -rotate-90',
                        isMenuItemActive(child) ? 'text-white' : 'text-slate-400',
                      ]"
                    />
                  </RouterLink>

                  <div v-if="child.children?.length" class="ml-2 mt-1 grid gap-1 border-l border-slate-200 pl-2">
                    <RouterLink
                      v-for="grandchild in child.children"
                      :key="grandchild.code"
                      :class="[
                        'rounded-md px-2 py-1.5 text-sm transition',
                        isMenuItemActive(grandchild)
                          ? 'bg-slate-950 !text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                      ]"
                      :to="grandchild.path || child.path || item.path || '/'"
                      @click="closeMenus"
                    >
                      <span :class="isMenuItemActive(grandchild) ? 'text-white' : 'text-slate-600'">
                        {{ grandchild.label }}
                      </span>
                    </RouterLink>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div :class="['border-t border-slate-200 p-3', sidebarCollapsed ? 'lg:p-2' : '']">
        <div :class="['rounded-md bg-slate-50 p-3', sidebarCollapsed ? 'lg:hidden' : '']">
          <div class="truncate text-sm font-medium text-slate-900">{{ userDisplayName(auth.state.user) }}</div>
          <div class="mt-0.5 truncate text-xs text-slate-500">{{ auth.state.user?.email }}</div>
          <button
            class="mt-3 h-8 w-full rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100"
            type="button"
            @click="logout"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>

    <div :class="['min-w-0 transition-[padding] duration-200', sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-72']">
      <header class="sticky top-0 z-20 flex h-14 min-w-0 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
        <div class="flex min-w-0 items-center gap-3">
          <button
            class="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-700 lg:hidden"
            type="button"
            @click="sidebarOpen = true"
          >
            <Menu class="h-4 w-4" />
          </button>
          <button
            class="hidden h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 lg:grid"
            :aria-label="sidebarCollapsed ? 'Mostrar menú lateral' : 'Ocultar menú lateral'"
            :title="sidebarCollapsed ? 'Mostrar menú' : 'Ocultar menú'"
            type="button"
            @click="toggleDesktopSidebar"
          >
            <Menu class="h-4 w-4" />
          </button>
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold text-slate-950">{{ activeRoot?.label || "Admin" }}</div>
            <div class="truncate text-xs text-slate-500">{{ route.path }}</div>
          </div>
        </div>
        <div class="flex min-w-0 shrink-0 items-center gap-2">
          <MenuFavorites role="admin" />
          <RouterLink
            class="relative grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
            title="Alertas de pánico"
            aria-label="Alertas de pánico"
            to="/admin/operacion/incidentes/panico"
          >
            <Bell class="h-4 w-4" />
            <span
              v-if="driverNotifications.state.unreadPanicCount"
              class="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white"
            >
              {{ driverNotifications.state.unreadPanicCount > 99 ? "99+" : driverNotifications.state.unreadPanicCount }}
            </span>
          </RouterLink>
        </div>
      </header>

      <main class="min-h-[calc(100vh-56px)] min-w-0 overflow-x-hidden">
        <RouterView />
      </main>
    </div>
  </div>
</template>
