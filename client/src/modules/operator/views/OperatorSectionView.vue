<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const title = computed(() =>
  route.path
    .replace(/^\/operator\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => part.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "))
    .join(" / ") || "Operación",
);
</script>

<template>
  <section class="p-4 md:p-6">
    <div class="rounded-lg border border-slate-200 bg-white p-6">
      <p class="text-sm font-medium uppercase tracking-[0.16em] text-emerald-700">Módulo de operación</p>
      <h1 class="mt-2 text-2xl font-semibold">{{ title }}</h1>
      <p class="mt-2 text-sm text-slate-600">La ruta y sus permisos se cargaron desde el menú configurado en la base de datos.</p>
    </div>
  </section>
</template>
