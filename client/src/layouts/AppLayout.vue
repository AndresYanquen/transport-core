<script setup>
import { computed } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

const route = useRoute();

const isAuthScreen = computed(() => route.name === "login" || route.name === "signup");
const isDriverLogin = computed(() => route.name === "driver-login");
const showTabBar = computed(() => !!route.meta.showTabBar);
const isDesktopLayout = computed(() => route.meta.layout === "desktop");
</script>

<template>
  <div v-if="isDesktopLayout" class="min-h-screen bg-slate-50">
    <RouterView />
  </div>

  <div v-else class="phone-stage" :class="{ 'driver-login-stage': isDriverLogin }">
    <div class="phone-shell" :class="{ 'auth-shell': isAuthScreen, 'driver-login-shell': isDriverLogin }">
      <main class="phone-content" :class="{ 'with-tabbar': showTabBar }">
        <RouterView />
      </main>

      <nav v-if="showTabBar" class="tabbar">
        <RouterLink to="/" class="tab-item" :class="{ active: route.meta.tab === 'rides' }">
          <span class="tab-icon">⌂</span>
          <span>Rides</span>
        </RouterLink>
        <RouterLink to="/trip" class="tab-item" :class="{ active: route.meta.tab === 'trip' }">
          <span class="tab-icon">🚕</span>
          <span>Trip</span>
        </RouterLink>
        <RouterLink to="/profile" class="tab-item" :class="{ active: route.meta.tab === 'profile' }">
          <span class="tab-icon">◉</span>
          <span>Profile</span>
        </RouterLink>
      </nav>
    </div>
  </div>
</template>
