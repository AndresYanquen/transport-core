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
    path: "/operator/operacion/:operationView?",
    name: "operator-operation",
    component: () => import("../modules/operator/views/OperatorOperationView.vue"),
    meta: {
      layout: "desktop",
      operatorShell: true,
      requiresAuth: true,
      requiresOperator: true,
    },
  },
  {
    path: "/operator/asignaciones/:assignmentView?",
    name: "operator-assignments",
    component: () => import("../modules/operator/views/OperatorAssignmentsView.vue"),
    meta: {
      layout: "desktop",
      operatorShell: true,
      requiresAuth: true,
      requiresOperator: true,
    },
  },
  {
    path: "/operator/conductores/:driverView?",
    name: "operator-drivers",
    component: () => import("../modules/operator/views/OperatorDriversView.vue"),
    meta: {
      layout: "desktop",
      operatorShell: true,
      requiresAuth: true,
      requiresOperator: true,
    },
  },
  {
    path: "/operator/clientes/:customerView?",
    name: "operator-customers",
    component: () => import("../modules/operator/views/OperatorCustomersView.vue"),
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
    path: "/admin/dashboard/metricas",
    name: "admin-dashboard-metrics",
    component: () => import("../modules/admin/views/AdminMetricsView.vue"),
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
    alias: "/admin/conductores/listado",
    component: () => import("../modules/admin/views/AdminDriversListView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/conductores/vehicles",
    name: "admin-driver-vehicles",
    alias: "/admin/conductores/vehiculos",
    component: () => import("../modules/admin/views/AdminDriverVehiclesView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/conductores/ratings",
    name: "admin-driver-ratings",
    alias: "/admin/conductores/calificaciones",
    component: () => import("../modules/admin/views/AdminDriverRatingsView.vue"),
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
    alias: "/admin/clientes/listado",
    component: () => import("../modules/admin/views/AdminCustomersView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/clientes/service-history",
    name: "admin-customer-service-history",
    alias: "/admin/clientes/historial-de-servicios",
    component: () => import("../modules/admin/views/AdminCustomerServiceHistoryView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/clientes/ratings",
    name: "admin-customer-ratings",
    alias: "/admin/clientes/calificaciones",
    component: () => import("../modules/admin/views/AdminCustomerRatingsView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/clientes/blocks",
    name: "admin-customer-blocks",
    alias: "/admin/clientes/bloqueos",
    component: () => import("../modules/admin/views/AdminCustomerBlocksView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/servicios",
    redirect: "/admin/servicios/taxi/tarifas",
  },
  {
    path: "/admin/servicios/:serviceGroup",
    redirect: (to) => `/admin/servicios/${to.params.serviceGroup}/tarifas`,
  },
  {
    path: "/admin/servicios/:serviceGroup/:serviceView",
    name: "admin-service-management",
    component: () => import("../modules/admin/views/AdminServiceManagementView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/operacion",
    name: "admin-operation-overview",
    component: () => import("../modules/admin/views/AdminOperationOverviewView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/operacion/solicitudes",
    name: "admin-operation-requests",
    alias: "/admin/operacion/solicitudes/:requestStatus",
    component: () => import("../modules/admin/views/AdminOperationRequestsView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/operacion/asignaciones",
    name: "admin-operation-assignments",
    alias: [
      "/admin/operacion/asignaciones/:assignmentView",
      "/admin/operaciones/asignaciones",
      "/admin/operaciones/asignaciones/:assignmentView",
    ],
    component: () => import("../modules/admin/views/AdminOperationAssignmentsView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/operacion/monitoreo",
    name: "admin-operation-monitoring",
    alias: "/admin/operacion/monitoreo/:monitoringView",
    component: () => import("../modules/admin/views/AdminOperationMonitoringView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/operacion/incidentes",
    name: "admin-operation-incidents",
    alias: "/admin/operacion/incidentes/:incidentView",
    component: () => import("../modules/admin/views/AdminOperationIncidentsView.vue"),
    meta: {
      layout: "desktop",
      adminShell: true,
      requiresAuth: true,
      requiresAdmin: true,
    },
  },
  {
    path: "/admin/operadoras",
    redirect: "/admin/operadoras/listado",
  },
  {
    path: "/admin/operadoras/listado",
    name: "admin-operators-list",
    alias: "/admin/operadoras/list",
    component: () => import("../modules/admin/views/AdminOperatorsListView.vue"),
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
    path: "/admin/reportes/:reportView?",
    name: "admin-reports",
    component: () => import("../modules/admin/views/AdminReportsView.vue"),
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
