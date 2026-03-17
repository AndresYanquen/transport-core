import { createRouter, createWebHistory } from "vue-router";
import {
  initializeSession,
  isAuthenticated,
  sessionRole,
  sessionState,
} from "../stores/session.js";

const routes = [
  {
    path: "/",
    name: "rides",
    component: () => import("../modules/rides/views/RidesView.vue"),
    meta: {
      requiresAuth: true,
      roles: ["client", "driver", "admin"],
      showTabBar: true,
      tab: "rides",
    },
  },
  {
    path: "/trip",
    name: "trip",
    component: () => import("../modules/rides/views/TripView.vue"),
    meta: {
      requiresAuth: true,
      roles: ["client", "driver", "admin"],
      showTabBar: true,
      tab: "trip",
    },
  },
  {
    path: "/profile",
    name: "profile",
    component: () => import("../modules/driver/views/ProfileView.vue"),
    meta: {
      requiresAuth: true,
      roles: ["client", "driver", "admin"],
      showTabBar: true,
      tab: "profile",
    },
  },
  {
    path: "/login",
    name: "login",
    component: () => import("../modules/auth/views/LoginView.vue"),
    meta: { guestOnly: true },
  },
  {
    path: "/signup",
    name: "signup",
    component: () => import("../modules/auth/views/SignupView.vue"),
    meta: { guestOnly: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  initializeSession();

  if (to.meta.guestOnly && isAuthenticated.value) {
    return { name: "rides" };
  }

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    const reason = sessionState.token ? "expired" : "required";
    return { name: "login", query: { redirect: to.fullPath, reason } };
  }

  const allowedRoles = to.meta.roles;
  if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
    if (!allowedRoles.includes(sessionRole.value)) {
      return { name: "rides" };
    }
  }

  return true;
});

export default router;
