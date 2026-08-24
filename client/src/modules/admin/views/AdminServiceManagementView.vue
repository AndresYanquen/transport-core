<script setup>
import { computed, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CheckCircle2, Plus, RefreshCw, Save, Search, Settings, Tag, X } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const operationalSettings = useOperationalSettings();

const route = useRoute();
const router = useRouter();

const groups = {
  taxi: {
    label: "Taxi",
    category: "ride",
    codes: ["standard", "premium", "xl", "pool"],
  },
  baul: {
    label: "Baúl",
    category: "delivery",
    codePrefix: "baul",
    codes: ["package_delivery"],
  },
  domicilio: {
    label: "Domicilio",
    category: "delivery",
    codePrefix: "domicilio",
    codes: ["food_delivery"],
  },
  despinchada: {
    label: "Despinchada",
    category: "roadside",
    codePrefix: "despinchada",
    codes: ["car_unstuck", "jump_start", "tire_change"],
  },
};

const sectionLabels = {
  tarifas: "Tarifas",
  configuracion: "Configuración",
};

const state = reactive({
  loading: true,
  savingCode: "",
  error: "",
  toast: "",
  createModalOpen: false,
  creating: false,
  serviceTypes: [],
  drafts: {},
  lastUpdatedAt: null,
});

const filters = reactive({
  search: "",
});

const createForm = reactive({
  code: "",
  name: "",
  description: "",
  icon: "",
  color: "#2563EB",
  basePrice: 0,
  isActive: true,
  sortOrder: 0,
});

const activeGroupKey = computed(() => {
  const key = String(route.params.serviceGroup || "taxi");
  return groups[key] ? key : "taxi";
});

const activeSection = computed(() => {
  const section = String(route.params.serviceView || "tarifas");
  return sectionLabels[section] ? section : "tarifas";
});

const activeGroup = computed(() => groups[activeGroupKey.value]);

const visibleServices = computed(() => {
  const allowed = new Set(activeGroup.value.codes);
  const category = activeGroup.value.category;
  const prefix = activeGroup.value.codePrefix;
  const query = filters.search.trim().toLowerCase();
  return state.serviceTypes
    .filter((service) => {
      if (allowed.has(service.code)) return true;
      if (activeGroupKey.value === "taxi") {
        return service.category === "ride" && !Object.values(groups).some((group) => group.codes.includes(service.code));
      }
      return service.category === category && prefix && String(service.code || "").startsWith(`${prefix}_`);
    })
    .filter((service) => {
      if (!query) return true;
      return [
        service.code,
        service.name,
        service.category,
        service.description,
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
});

const activeCount = computed(() => visibleServices.value.filter((service) => service.isActive).length);
const totalBasePrice = computed(() => visibleServices.value.reduce((sum, service) => sum + Number(service.basePrice || 0), 0));

async function fetchServices() {
  state.loading = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/service-types?includeInactive=true", { method: "GET" });
    state.serviceTypes = data?.serviceTypes || [];
    syncDrafts();
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar los servicios.";
  } finally {
    state.loading = false;
  }
}

function syncDrafts() {
  const nextDrafts = {};
  for (const service of state.serviceTypes) {
    nextDrafts[service.code] = {
      name: service.name || "",
      description: service.description || "",
      color: service.color || "",
      basePrice: Number(service.basePrice || 0),
      isActive: Boolean(service.isActive),
      sortOrder: Number(service.sortOrder || 0),
    };
  }
  state.drafts = nextDrafts;
}

function formatCurrency(value) {
  return operationalSettings.formatCurrency(value);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function openSection(section) {
  router.replace(`/admin/servicios/${activeGroupKey.value}/${section}`);
}

function resetCreateForm() {
  createForm.code = "";
  createForm.name = "";
  createForm.description = "";
  createForm.icon = "";
  createForm.color = "#2563EB";
  createForm.basePrice = 0;
  createForm.isActive = true;
  createForm.sortOrder = nextSortOrder();
}

function openCreateModal() {
  resetCreateForm();
  state.error = "";
  state.toast = "";
  state.createModalOpen = true;
}

function closeCreateModal() {
  if (state.creating) return;
  state.createModalOpen = false;
}

function nextSortOrder() {
  const values = visibleServices.value.map((service) => Number(service.sortOrder || 0));
  return values.length ? Math.max(...values) + 10 : (activeGroup.value.codes.length + 1) * 10;
}

function normalizeCodeFromName() {
  if (createForm.code.trim()) return;
  const normalizedName = createForm.name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 50);
  const prefix = activeGroup.value.codePrefix;
  createForm.code = prefix && !normalizedName.startsWith(`${prefix}_`)
    ? `${prefix}_${normalizedName}`.slice(0, 50)
    : normalizedName;
}

async function createService() {
  state.creating = true;
  state.error = "";
  state.toast = "";

  try {
    const data = await apiRequest("/api/service-types", {
      method: "POST",
      body: {
        code: createForm.code,
        category: activeGroup.value.category,
        name: createForm.name,
        description: createForm.description || null,
        icon: createForm.icon || null,
        color: createForm.color || null,
        basePrice: Number(createForm.basePrice || 0),
        isActive: Boolean(createForm.isActive),
        sortOrder: Number(createForm.sortOrder || 0),
      },
    });
    if (data?.serviceType) {
      state.serviceTypes = [data.serviceType, ...state.serviceTypes];
      syncDrafts();
    }
    state.toast = "Servicio creado.";
    state.createModalOpen = false;
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudo crear el servicio.";
  } finally {
    state.creating = false;
  }
}

async function savePrice(service) {
  const draft = state.drafts[service.code];
  if (!draft) return;
  await patchService(service.code, {
    basePrice: Number(draft.basePrice || 0),
  });
}

async function saveConfig(service) {
  const draft = state.drafts[service.code];
  if (!draft) return;
  await patchService(service.code, {
    name: draft.name,
    description: draft.description || null,
    color: draft.color || null,
    isActive: Boolean(draft.isActive),
    sortOrder: Number(draft.sortOrder || 0),
  });
}

async function patchService(code, payload) {
  state.savingCode = code;
  state.error = "";
  state.toast = "";

  try {
    const data = await apiRequest(`/api/service-types/${code}`, {
      method: "PATCH",
      body: payload,
    });
    const index = state.serviceTypes.findIndex((service) => service.code === code);
    if (index >= 0 && data?.serviceType) {
      state.serviceTypes[index] = data.serviceType;
    }
    syncDrafts();
    state.toast = "Cambios guardados.";
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudo guardar el servicio.";
  } finally {
    state.savingCode = "";
  }
}

watch(
  () => [route.params.serviceGroup, route.params.serviceView],
  () => {
    filters.search = "";
  },
);

onMounted(async () => {
  await operationalSettings.fetchOperationalSettings();
  fetchServices();
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Servicios</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">{{ activeGroup.label }} · {{ sectionLabels[activeSection] }}</h1>
        <p class="mt-1 text-sm text-slate-500">Tarifa actual y configuración de tipos de servicio.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        :disabled="state.loading"
        type="button"
        @click="fetchServices"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white hover:bg-slate-800"
        type="button"
        @click="openCreateModal"
      >
        <Plus class="h-4 w-4" />
        Nuevo servicio
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{{ state.error }}</div>
    <div v-if="state.toast" class="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <CheckCircle2 class="h-4 w-4" />
      {{ state.toast }}
    </div>

    <div class="grid gap-3 md:grid-cols-3">
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="text-2xl font-semibold text-slate-950">{{ visibleServices.length }}</div>
        <div class="mt-1 text-sm text-slate-500">Tipos en {{ activeGroup.label }}</div>
      </div>
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="text-2xl font-semibold text-slate-950">{{ activeCount }}</div>
        <div class="mt-1 text-sm text-slate-500">Activos</div>
      </div>
      <div class="rounded-md border border-slate-200 bg-white p-4">
        <div class="text-2xl font-semibold text-slate-950">{{ formatCurrency(totalBasePrice) }}</div>
        <div class="mt-1 text-sm text-slate-500">Suma tarifa base</div>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white">
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 class="text-base font-semibold text-slate-950">{{ sectionLabels[activeSection] }}</h2>
          <p class="text-sm text-slate-500">
            {{ visibleServices.length }} visibles
            <span v-if="state.lastUpdatedAt"> · actualizado {{ formatDate(state.lastUpdatedAt) }}</span>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            :class="[
              'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium',
              activeSection === 'tarifas' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ]"
            type="button"
            @click="openSection('tarifas')"
          >
            <Tag class="h-4 w-4" />
            Tarifas
          </button>
          <button
            :class="[
              'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium',
              activeSection === 'configuracion' ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ]"
            type="button"
            @click="openSection('configuracion')"
          >
            <Settings class="h-4 w-4" />
            Configuración
          </button>
          <label class="relative">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              v-model.trim="filters.search"
              class="h-9 w-72 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Buscar tipo de servicio"
            />
          </label>
        </div>
      </div>

      <div class="overflow-auto">
        <table v-if="activeSection === 'tarifas'" class="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Servicio</th>
              <th class="py-2 pr-3">Código</th>
              <th class="py-2 pr-3">Tarifa actual</th>
              <th class="py-2 pr-3">Nueva tarifa base</th>
              <th class="py-2 pr-4">Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="service in visibleServices" :key="service.code" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <div class="font-medium text-slate-950">{{ service.name }}</div>
                <div class="text-xs text-slate-500">{{ service.description || "Sin descripción" }}</div>
              </td>
              <td class="py-3 pr-3 font-mono text-xs">{{ service.code }}</td>
              <td class="py-3 pr-3 font-semibold text-slate-950">{{ formatCurrency(service.basePrice) }}</td>
              <td class="py-3 pr-3">
                <input
                  v-model.number="state.drafts[service.code].basePrice"
                  class="h-9 w-40 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  min="0"
                  step="100"
                  type="number"
                />
              </td>
              <td class="py-3 pr-4">
                <button
                  class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white hover:bg-slate-800 disabled:opacity-60"
                  :disabled="state.savingCode === service.code"
                  type="button"
                  @click="savePrice(service)"
                >
                  <Save class="h-4 w-4" />
                  Guardar
                </button>
              </td>
            </tr>
            <tr v-if="!state.loading && visibleServices.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="5">No hay servicios para este grupo.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="5">Cargando servicios...</td>
            </tr>
          </tbody>
        </table>

        <table v-else class="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th class="py-2 pl-4 pr-3">Servicio</th>
              <th class="py-2 pr-3">Descripción</th>
              <th class="py-2 pr-3">Color</th>
              <th class="py-2 pr-3">Orden</th>
              <th class="py-2 pr-3">Activo</th>
              <th class="py-2 pr-4">Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="service in visibleServices" :key="service.code" class="border-b border-slate-100 text-slate-700">
              <td class="py-3 pl-4 pr-3">
                <input
                  v-model.trim="state.drafts[service.code].name"
                  class="h-9 w-48 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                />
                <div class="mt-1 font-mono text-xs text-slate-500">{{ service.code }}</div>
              </td>
              <td class="py-3 pr-3">
                <input
                  v-model.trim="state.drafts[service.code].description"
                  class="h-9 w-80 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                />
              </td>
              <td class="py-3 pr-3">
                <div class="flex items-center gap-2">
                  <span class="h-6 w-6 rounded-md border border-slate-200" :style="{ backgroundColor: state.drafts[service.code].color || '#ffffff' }"></span>
                  <input
                    v-model.trim="state.drafts[service.code].color"
                    class="h-9 w-28 rounded-md border border-slate-300 px-3 font-mono text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                    placeholder="#2563EB"
                  />
                </div>
              </td>
              <td class="py-3 pr-3">
                <input
                  v-model.number="state.drafts[service.code].sortOrder"
                  class="h-9 w-24 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  type="number"
                />
              </td>
              <td class="py-3 pr-3">
                <label class="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input v-model="state.drafts[service.code].isActive" class="h-4 w-4" type="checkbox" />
                  Activo
                </label>
              </td>
              <td class="py-3 pr-4">
                <button
                  class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white hover:bg-slate-800 disabled:opacity-60"
                  :disabled="state.savingCode === service.code"
                  type="button"
                  @click="saveConfig(service)"
                >
                  <Save class="h-4 w-4" />
                  Guardar
                </button>
              </td>
            </tr>
            <tr v-if="!state.loading && visibleServices.length === 0">
              <td class="py-10 text-center text-slate-500" colspan="6">No hay servicios para este grupo.</td>
            </tr>
            <tr v-if="state.loading">
              <td class="py-10 text-center text-slate-500" colspan="6">Cargando configuración...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="state.createModalOpen" class="fixed inset-0 z-[1200] grid place-items-center overflow-y-auto bg-slate-950/40 p-3 sm:p-4">
      <form class="w-full max-w-2xl rounded-md bg-white shadow-2xl" @submit.prevent="createService">
        <div class="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Nuevo servicio</h2>
            <p class="mt-1 text-sm text-slate-500">Se creará dentro del grupo {{ activeGroup.label }}.</p>
          </div>
          <button
            class="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            type="button"
            @click="closeCreateModal"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="grid gap-4 p-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm">
              <span class="font-medium text-slate-700">Nombre</span>
              <input
                v-model.trim="createForm.name"
                class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="Taxi Ejecutivo"
                required
                @blur="normalizeCodeFromName"
              />
            </label>
            <label class="grid gap-1 text-sm">
              <span class="font-medium text-slate-700">Código</span>
              <input
                v-model.trim="createForm.code"
                class="h-9 rounded-md border border-slate-300 px-3 font-mono text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                pattern="[a-z][a-z0-9_-]{1,49}"
                placeholder="taxi_ejecutivo"
                required
              />
            </label>
          </div>

          <label class="grid gap-1 text-sm">
            <span class="font-medium text-slate-700">Descripción</span>
            <textarea
              v-model.trim="createForm.description"
              class="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="Descripción visible para operación y app."
            ></textarea>
          </label>

          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label class="grid gap-1 text-sm">
              <span class="font-medium text-slate-700">Tarifa base</span>
              <input
                v-model.number="createForm.basePrice"
                class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                min="0"
                step="100"
                type="number"
              />
            </label>
            <label class="grid gap-1 text-sm">
              <span class="font-medium text-slate-700">Color</span>
              <div class="flex items-center gap-2">
                <input v-model="createForm.color" class="h-9 w-12 rounded-md border border-slate-300 p-1" type="color" />
                <input
                  v-model.trim="createForm.color"
                  class="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 font-mono text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="#2563EB"
                />
              </div>
            </label>
            <label class="grid gap-1 text-sm">
              <span class="font-medium text-slate-700">Icono</span>
              <input
                v-model.trim="createForm.icon"
                class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="car"
              />
            </label>
            <label class="grid gap-1 text-sm">
              <span class="font-medium text-slate-700">Orden</span>
              <input
                v-model.number="createForm.sortOrder"
                class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                type="number"
              />
            </label>
          </div>

          <label class="inline-flex items-center gap-2 text-sm text-slate-700">
            <input v-model="createForm.isActive" class="h-4 w-4" type="checkbox" />
            Crear activo para que aparezca en la app y flujos operativos.
          </label>
        </div>

        <div class="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4">
          <button
            class="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
            @click="closeCreateModal"
          >
            Cancelar
          </button>
          <button
            class="inline-flex h-9 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white hover:bg-slate-800 disabled:opacity-60"
            :disabled="state.creating"
            type="submit"
          >
            <Save :class="['h-4 w-4', state.creating ? 'animate-pulse' : '']" />
            Crear servicio
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
