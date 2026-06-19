<script setup>
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import AdminPanelLayout from "./AdminPanelLayout.vue";
import OperatorPanelLayout from "./OperatorPanelLayout.vue";

const route = useRoute();

const isDesktopLayout = computed(() => route.meta.layout === "desktop");
const isAdminShell = computed(() => route.meta.adminShell === true);
const isOperatorShell = computed(() => route.meta.operatorShell === true);
</script>

<template>
  <AdminPanelLayout v-if="isAdminShell" />
  <OperatorPanelLayout v-else-if="isOperatorShell" />

  <div v-else-if="isDesktopLayout" class="min-h-screen bg-slate-50">
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
