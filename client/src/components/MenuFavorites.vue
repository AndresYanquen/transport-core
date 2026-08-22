<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  ChevronDown,
  Settings,
  Star,
  X,
} from "lucide-vue-next";
import { useMenuFavoritesStore } from "../stores/menuFavorites.js";

const props = defineProps({
  role: {
    type: String,
    required: true,
  },
  compact: {
    type: Boolean,
    default: false,
  },
});

const favorites = useMenuFavoritesStore();
const dropdownOpen = ref(false);
const modalOpen = ref(false);
const selectedCodes = ref([]);
const localError = ref("");

const availableItems = computed(() =>
  favorites.state.availableItems.filter((item) => item.path && !item.children?.length),
);

const favoriteItems = computed(() => favorites.state.favorites.filter((item) => item.path));

function openManager() {
  selectedCodes.value = favorites.state.favorites.map((item) => item.code);
  localError.value = "";
  modalOpen.value = true;
  dropdownOpen.value = false;
}

function toggleCode(code) {
  const set = new Set(selectedCodes.value);
  if (set.has(code)) {
    set.delete(code);
  } else {
    set.add(code);
  }
  selectedCodes.value = [...set];
}

async function save() {
  localError.value = "";
  try {
    await favorites.saveFavorites(props.role, selectedCodes.value);
    modalOpen.value = false;
  } catch (error) {
    localError.value = error?.message || "No se pudieron guardar favoritos.";
  }
}

watch(() => props.role, () => {
  favorites.fetchFavorites(props.role).catch(() => {});
});

onMounted(() => {
  favorites.fetchFavorites(props.role).catch(() => {});
});
</script>

<template>
  <div class="relative">
    <button
      :class="[
        'inline-flex h-9 items-center gap-2 rounded-md border border-amber-100 bg-amber-50 px-3 text-sm font-medium text-slate-800 hover:bg-amber-100',
        compact ? 'w-full justify-center' : '',
      ]"
      type="button"
      @click="dropdownOpen = !dropdownOpen"
    >
      <Star class="h-4 w-4 fill-amber-400 text-amber-500" />
      <span v-if="!compact">Menú Favoritos</span>
      <ChevronDown v-if="!compact" class="h-3.5 w-3.5 text-slate-500" />
    </button>

    <div
      v-if="dropdownOpen"
      class="absolute right-0 top-11 z-[1500] w-72 rounded-md border border-slate-200 bg-white p-2 shadow-xl"
    >
      <div class="flex items-start justify-between gap-3 px-2 py-1">
        <div>
          <div class="text-sm font-semibold text-slate-950">Menú Favoritos</div>
          <div class="text-xs text-slate-500">Accede rápido a tus módulos.</div>
        </div>
        <button
          class="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          type="button"
          title="Gestionar favoritos"
          @click="openManager"
        >
          <Settings class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-2 grid gap-1">
        <RouterLink
          v-for="item in favoriteItems"
          :key="item.code"
          class="flex min-h-9 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-950"
          :to="item.path"
          @click="dropdownOpen = false"
        >
          <span class="truncate">{{ item.label }}</span>
          <Star class="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
        </RouterLink>
        <div v-if="!favorites.state.loading && !favoriteItems.length" class="px-2 py-6 text-center text-sm text-slate-500">
          No tienes favoritos.
        </div>
        <div v-if="favorites.state.loading" class="px-2 py-6 text-center text-sm text-slate-500">
          Cargando...
        </div>
      </div>

      <button
        class="mt-2 flex h-9 w-full items-center gap-2 rounded-md border-t border-slate-100 px-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        type="button"
        @click="openManager"
      >
        <Star class="h-4 w-4 text-amber-500" />
        Gestionar favoritos
      </button>
    </div>

    <div v-if="modalOpen" class="fixed inset-0 z-[1700] grid place-items-center bg-slate-950/40 p-4">
      <div class="w-full max-w-lg rounded-md bg-white shadow-2xl">
        <div class="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Gestionar favoritos</h2>
            <p class="mt-1 text-sm text-slate-500">Selecciona los módulos que quieres ver en el acceso rápido.</p>
          </div>
          <button
            class="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            type="button"
            @click="modalOpen = false"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="max-h-[60vh] overflow-auto p-4">
          <div v-if="localError || favorites.state.error" class="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {{ localError || favorites.state.error }}
          </div>
          <div class="grid gap-1">
            <button
              v-for="item in availableItems"
              :key="item.code"
              class="flex min-h-10 items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-slate-100"
              type="button"
              @click="toggleCode(item.code)"
            >
              <span class="min-w-0 truncate text-slate-800">{{ item.label }}</span>
              <Star
                :class="[
                  'h-4 w-4',
                  selectedCodes.includes(item.code) ? 'fill-amber-400 text-amber-500' : 'text-slate-300',
                ]"
              />
            </button>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-slate-200 p-4">
          <button
            class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
            @click="modalOpen = false"
          >
            Cancelar
          </button>
          <button
            class="h-9 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            :disabled="favorites.state.saving"
            type="button"
            @click="save"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
