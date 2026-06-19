<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();

const title = computed(() => {
  const parts = route.path
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(Boolean);

  if (!parts.length) return "Dashboard";

  return parts
    .map((part) =>
      part
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    )
    .join(" / ");
});
</script>

<template>
  <section class="p-4">
    <div class="rounded-md border border-slate-200 bg-white p-6">
      <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Módulo admin</p>
      <h1 class="mt-2 text-2xl font-semibold text-slate-950">{{ title }}</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        La navegación y permisos de este módulo ya están configurados. Esta pantalla queda lista para conectar tablas, formularios y acciones específicas.
      </p>
    </div>
  </section>
</template>
