import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const routes = [
  {
    path: "/",
    redirect: { name: "admin-login" },
  },
  {
    path: "/operator/login",
    name: "operator-login",
    component: () => import("../modules/admin/views/AdminLoginView.vue"),
    meta: {
      layout: "desktop",
      guestOnly: true,
      loginRole: "operator",
    },
  },
  {
    path: "/operator",
    name: "operator-dashboard",
    component: () => import("../modules/operator/views/OperatorDashboardView.vue"),
    meta: {
      layout: "desktop",
      operatorShell: true,
      requiresAuth: true,
      requiresOperator: true,
    },
  },
  {
    path: "/operator/mapa",
    name: "operator-hot-zones",
    component: () => import("../modules/operator/views/OperatorMapView.vue"),
    meta: {
      layout: "desktop",
      operatorShell: true,
      requiresAuth: true,
      requiresOperator: true,
    },
  },
  {
    path: "/operator/:pathMatch(.*)*",
    name: "operator-section",
    component: () => import("../modules/operator/views/OperatorSectionView.vue"),
    meta: {
      layout: "desktop",
      operatorShell: true,
      requiresAuth: true,
      requiresOperator: true,
    },
  },
  {
    path: "/admin/dashboard",
    name: "admin-dashboard",
    component: () => import("../modules/admin/views/AdminDashboardView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/simulation",
    name: "admin-simulation",
    component: () => import("../modules/admin/views/SimulationAdminView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/dashboard/mapa",
    name: "admin-dashboard-map",
    component: () => import("../modules/admin/views/AdminDriversMapView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/dashboard/:pathMatch(.*)*",
    name: "admin-dashboard-section",
    component: () => import("../modules/admin/views/AdminSectionView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/login",
    name: "admin-login",
    component: () => import("../modules/admin/views/AdminLoginView.vue"),
    meta: {
      layout: "desktop",
      guestOnly: true,
      loginRole: "admin",
    },
  },
  {
    path: "/admin/dashboard/resumen",
    redirect: { name: "admin-dashboard" },
  },
  {
    path: "/admin/seguridad/usuarios",
    name: "admin-users",
    component: () => import("../modules/admin/views/AdminUsersView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/conductores/list",
    name: "admin-drivers-list",
    component: () => import("../modules/admin/views/AdminDriversListView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/clientes",
    redirect: { name: "admin-customers-list" },
  },
  {
    path: "/admin/clientes/list",
    name: "admin-customers-list",
    component: () => import("../modules/admin/views/AdminCustomersView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/zonas/mapa-de-cobertura",
    name: "admin-zones-coverage-map",
    component: () => import("../modules/admin/views/AdminZonesMapView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/zonas/hot-zones",
    name: "admin-hot-zones",
    component: () => import("../modules/admin/views/AdminHotZonesView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/configuracion/operational-parameters",
    name: "admin-operational-parameters",
    component: () => import("../modules/admin/views/AdminOperationalParametersView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/:pathMatch(.*)*",
    name: "admin-section",
    component: () => import("../modules/admin/views/AdminSectionView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.restore();

  if (to.meta.guestOnly && auth.isAuthenticated.value) {
    if (auth.isOperator.value) return { name: "operator-dashboard" };
    if (auth.isAdmin.value) return { name: "admin-dashboard" };
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated.value) {
    return {
      name: to.meta.requiresOperator ? "operator-login" : "admin-login",
      query: { redirect: to.fullPath },
    };
  }

  if (to.meta.requiresAdmin && !auth.isAdmin.value) {
    auth.logout();
    return {
      name: "admin-login",
      query: { redirect: to.fullPath },
    };
  }

  if (to.meta.requiresOperator && !auth.isOperator.value) {
    auth.logout();
    return {
      name: "operator-login",
      query: { redirect: to.fullPath },
    };
  }

  return true;
});

export default router;
