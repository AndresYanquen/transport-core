import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "admin-simulation",
    component: () => import("../modules/admin/views/SimulationAdminView.vue"),
    meta: {
      layout: "desktop",
    },
  },
  {
    path: "/admin/simulation",
    redirect: { name: "admin-simulation" },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
