<script setup>
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";

const route = useRoute();

const isDesktopLayout = computed(() => route.meta.layout === "desktop");
</script>

<template>
  <div v-if="isDesktopLayout" class="min-h-screen bg-slate-50">
    <RouterView />
  </div>

  <div v-else class="phone-stage">
    <div class="phone-shell">
      <main class="phone-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
