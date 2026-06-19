<script setup>
import { AlertTriangle, Car, Clock3, Headset, Map, UserCheck } from "lucide-vue-next";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useAuthStore } from "../../../stores/auth.js";
import { useOperatorNavigationStore } from "../../../stores/operatorNavigation.js";

const auth = useAuthStore();
const navigation = useOperatorNavigationStore();

const operatorProfile = computed(() => auth.state.user?.profile?.operator || {});
const shortcuts = computed(() =>
  navigation.state.items
    .filter((item) => item.path && item.path !== "/operator")
    .slice(0, 6),
);

const cards = [
  { label: "Solicitudes pendientes", value: "—", icon: Clock3, tone: "text-amber-700 bg-amber-50" },
  { label: "Servicios activos", value: "—", icon: Car, tone: "text-blue-700 bg-blue-50" },
  { label: "Conductores disponibles", value: "—", icon: UserCheck, tone: "text-emerald-700 bg-emerald-50" },
  { label: "Alertas operativas", value: "—", icon: AlertTriangle, tone: "text-rose-700 bg-rose-50" },
];
</script>

<template>
  <section class="p-4 md:p-6">
    <div class="rounded-lg bg-slate-950 p-6 text-white">
      <div class="flex items-center gap-2 text-sm text-emerald-300">
        <Headset class="h-4 w-4" />
        Panel de operadora
      </div>
      <h1 class="mt-3 text-2xl font-semibold">
        Bienvenida, {{ auth.state.user?.firstName || "operadora" }}
      </h1>
      <p class="mt-2 text-sm text-slate-300">
        {{ operatorProfile.operationZone || "Zona de operación sin asignar" }}
        <span v-if="operatorProfile.shift"> · Turno {{ operatorProfile.shift }}</span>
      </p>
    </div>

    <div class="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article v-for="card in cards" :key="card.label" class="rounded-lg border border-slate-200 bg-white p-4">
        <div :class="['grid h-9 w-9 place-items-center rounded-md', card.tone]">
          <component :is="card.icon" class="h-4 w-4" />
        </div>
        <div class="mt-4 text-2xl font-semibold">{{ card.value }}</div>
        <div class="mt-1 text-sm text-slate-600">{{ card.label }}</div>
      </article>
    </div>

    <div class="mt-5 grid gap-5 lg:grid-cols-[1fr_0.65fr]">
      <article class="rounded-lg border border-slate-200 bg-white p-5">
        <h2 class="font-semibold">Accesos de operación</h2>
        <p class="mt-1 text-sm text-slate-500">Opciones habilitadas desde la configuración de la base de datos.</p>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <RouterLink
            v-for="item in shortcuts"
            :key="item.code"
            class="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm font-medium hover:border-emerald-300 hover:bg-emerald-50"
            :to="item.path"
          >
            {{ item.label }}
            <Map class="h-4 w-4 text-slate-400" />
          </RouterLink>
        </div>
      </article>

      <article class="rounded-lg border border-slate-200 bg-white p-5">
        <h2 class="font-semibold">Perfil del turno</h2>
        <dl class="mt-4 grid gap-3 text-sm">
          <div><dt class="text-slate-500">Código</dt><dd class="font-medium">{{ operatorProfile.employeeCode || "Sin asignar" }}</dd></div>
          <div><dt class="text-slate-500">Zona</dt><dd class="font-medium">{{ operatorProfile.operationZone || "Sin asignar" }}</dd></div>
          <div><dt class="text-slate-500">Turno</dt><dd class="font-medium">{{ operatorProfile.shift || "Sin asignar" }}</dd></div>
        </dl>
      </article>
    </div>
  </section>
</template>
