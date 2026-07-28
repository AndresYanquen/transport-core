<script setup>
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Edit3, Info, MapPinned, MousePointer2, RefreshCw, Save, Trash2, Undo2, X } from "lucide-vue-next";
import { apiRequest } from "../../../services/api.js";
import { useOperationalSettings } from "../../../stores/operationalSettings.js";

const mapEl = ref(null);
const operationalSettings = useOperationalSettings();
const state = reactive({
  loading: true,
  saving: false,
  drawing: false,
  error: "",
  success: "",
  tutorial: "",
  zonePendingDelete: null,
  editingZoneId: null,
  zones: [],
  points: [],
});

const form = reactive({
  name: "",
  type: "operational",
  status: "active",
  color: "#2563EB",
});

let map = null;
let previewLayer = null;
let zoneLayer = null;
let tutorialTimer = null;

const isEditing = computed(() => Boolean(state.editingZoneId));
const canSave = computed(() => form.name.trim() && state.points.length >= 3 && !state.saving);

const typeLabels = {
  operational: "Zona operativa",
  hot_zone: "Hot Zone",
  restricted: "Restringida",
  pricing_zone: "Tarifa por zona",
};

async function fetchZones() {
  state.loading = true;
  state.error = "";

  try {
    const result = await apiRequest("/api/admin/zones", { method: "GET" });
    state.zones = result?.zones || [];
    renderZones();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar zonas.";
  } finally {
    state.loading = false;
  }
}

function initMap() {
  if (!mapEl.value || map) return;

  const center = operationalSettings.mapCenter.value;
  map = L.map(mapEl.value, {
    zoomControl: true,
  }).setView([center.lat, center.lng], operationalSettings.mapDefaultZoom.value);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(map);

  zoneLayer = L.layerGroup().addTo(map);
  previewLayer = L.layerGroup().addTo(map);
  map.on("click", onMapClick);
}

function onMapClick(event) {
  if (!state.drawing) return;
  state.points.push([event.latlng.lng, event.latlng.lat]);
  renderPreview();
}

function renderPreview() {
  if (!previewLayer) return;
  previewLayer.clearLayers();

  for (const [index, [lng, lat]] of state.points.entries()) {
    const marker = L.marker([lat, lng], {
      draggable: true,
      autoPan: true,
      icon: L.divIcon({
        className: "",
        html: `<span class="zone-vertex" style="--zone-color: ${form.color}">${index + 1}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(previewLayer);

    marker.on("drag", (event) => {
      const next = event.target.getLatLng();
      state.points[index] = [next.lng, next.lat];
      renderPreviewShape();
    });

    marker.on("dragend", (event) => {
      const next = event.target.getLatLng();
      state.points[index] = [next.lng, next.lat];
      renderPreview();
    });
  }

  renderPreviewShape();
}

function renderPreviewShape() {
  if (!previewLayer) return;

  previewLayer.eachLayer((layer) => {
    if (layer instanceof L.Polyline || layer instanceof L.Polygon) {
      previewLayer.removeLayer(layer);
    }
  });

  if (state.points.length >= 2) {
    const latLngs = state.points.map(([lng, lat]) => [lat, lng]);
    L.polyline(latLngs, {
      color: form.color,
      dashArray: "6 5",
      weight: 2,
    }).addTo(previewLayer);
  }

  if (state.points.length >= 3) {
    const latLngs = state.points.map(([lng, lat]) => [lat, lng]);
    L.polygon(latLngs, {
      color: form.color,
      fillColor: form.color,
      fillOpacity: 0.16,
      weight: 2,
    }).addTo(previewLayer);
  }
}

function renderZones() {
  if (!zoneLayer) return;
  zoneLayer.clearLayers();

  for (const zone of state.zones) {
    if (zone.id === state.editingZoneId) continue;

    const latLngs = (zone.coordinates || []).map(([lng, lat]) => [lat, lng]);
    if (latLngs.length < 4) continue;

    const polygon = L.polygon(latLngs, {
      color: zone.color || "#2563EB",
      fillColor: zone.color || "#2563EB",
      fillOpacity: zone.status === "active" ? 0.18 : 0.08,
      weight: 2,
    }).addTo(zoneLayer);

    polygon.bindPopup(`<strong>${zone.name}</strong><br>${typeLabels[zone.type] || zone.type}`);
  }
}

function startDrawing() {
  state.editingZoneId = null;
  state.drawing = true;
  state.error = "";
  state.success = "";
  form.name = "";
  form.type = "operational";
  form.status = "active";
  form.color = "#2563EB";
  showTutorial();
  state.points = [];
  renderPreview();
  renderZones();
}

function showTutorial() {
  state.tutorial = "Haz click sobre el mapa para agregar puntos. Arrastra cualquier punto numerado para ajustar el polígono antes de guardarlo.";
  if (tutorialTimer) window.clearTimeout(tutorialTimer);
  tutorialTimer = window.setTimeout(() => {
    state.tutorial = "";
    tutorialTimer = null;
  }, 7000);
}

function closeTutorial() {
  state.tutorial = "";
  if (tutorialTimer) {
    window.clearTimeout(tutorialTimer);
    tutorialTimer = null;
  }
}

function undoPoint() {
  state.points.pop();
  renderPreview();
}

function cancelDrawing() {
  resetForm();
}

function resetForm() {
  form.name = "";
  form.type = "operational";
  form.status = "active";
  form.color = "#2563EB";
  state.editingZoneId = null;
  state.points = [];
  state.drawing = false;
  renderPreview();
  renderZones();
}

async function saveZone() {
  if (!canSave.value) return;
  state.saving = true;
  state.error = "";
  state.success = "";

  try {
    const payload = {
      name: form.name,
      type: form.type,
      status: form.status,
      color: form.color,
      coordinates: state.points,
    };
    const result = await apiRequest(isEditing.value ? `/api/admin/zones/${state.editingZoneId}` : "/api/admin/zones", {
      method: isEditing.value ? "PUT" : "POST",
      body: payload,
    });

    if (isEditing.value) {
      state.zones = state.zones.map((zone) => (zone.id === result.zone.id ? result.zone : zone));
      state.success = `Zona actualizada: ${result.zone.name}`;
    } else {
      state.zones = [result.zone, ...state.zones];
      state.success = `Zona guardada: ${result.zone.name}`;
    }

    resetForm();
    renderZones();
  } catch (err) {
    state.error = err?.message || (isEditing.value ? "No se pudo actualizar la zona." : "No se pudo guardar la zona.");
  } finally {
    state.saving = false;
  }
}

function editZone(zone) {
  state.editingZoneId = zone.id;
  state.drawing = true;
  state.error = "";
  state.success = "";
  form.name = zone.name || "";
  form.type = zone.type || "operational";
  form.status = zone.status || "active";
  form.color = zone.color || "#2563EB";
  state.points = (zone.coordinates || []).slice(0, -1).map(([lng, lat]) => [lng, lat]);
  renderZones();
  renderPreview();
  fitZone(zone);
  showTutorial();
}

function requestDeleteZone(zone) {
  state.zonePendingDelete = zone;
}

function cancelDeleteZone() {
  state.zonePendingDelete = null;
}

async function confirmDeleteZone() {
  const zone = state.zonePendingDelete;
  if (!zone) return;
  state.error = "";
  state.success = "";

  try {
    await apiRequest(`/api/admin/zones/${zone.id}`, { method: "DELETE" });
    state.zones = state.zones.filter((item) => item.id !== zone.id);
    state.success = `Zona eliminada: ${zone.name}`;
    state.zonePendingDelete = null;
    if (state.editingZoneId === zone.id) {
      resetForm();
    }
    renderZones();
  } catch (err) {
    state.error = err?.message || "No se pudo eliminar la zona.";
  }
}

function fitZone(zone) {
  if (!map) return;
  const latLngs = (zone.coordinates || []).map(([lng, lat]) => [lat, lng]);
  if (latLngs.length < 4) return;
  map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] });
}

watch(
  () => form.color,
  () => renderPreview(),
);

onMounted(async () => {
  await operationalSettings.fetchOperationalSettings();
  await nextTick();
  initMap();
  await fetchZones();
  setTimeout(() => map?.invalidateSize(), 100);
});

onBeforeUnmount(() => {
  closeTutorial();
  if (map) {
    map.off("click", onMapClick);
    map.remove();
    map = null;
  }
});
</script>

<template>
  <section class="grid gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Zonas</p>
        <h1 class="mt-1 text-2xl font-semibold text-slate-950">Mapa de Cobertura</h1>
        <p class="mt-1 text-sm text-slate-500">Dibuja polígonos, asigna tipo y guarda coordenadas.</p>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        type="button"
        @click="fetchZones"
      >
        <RefreshCw class="h-4 w-4" />
        Actualizar
      </button>
    </div>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>
    <div v-if="state.success" class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {{ state.success }}
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div class="flex items-center gap-2 text-sm font-medium text-slate-800">
            <MapPinned class="h-4 w-4" />
            Leaflet
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="inline-flex h-8 items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800"
              type="button"
              @click="startDrawing"
            >
              <MousePointer2 class="h-4 w-4" />
              Nueva zona
            </button>
            <button
              class="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              :disabled="state.points.length === 0"
              type="button"
              @click="undoPoint"
            >
              <Undo2 class="h-4 w-4" />
              Deshacer punto
            </button>
          </div>
        </div>
        <div class="relative">
          <div ref="mapEl" class="h-[620px] w-full"></div>
          <div
            v-if="state.tutorial"
            class="absolute left-4 top-4 z-[1000] flex max-w-md items-start gap-3 rounded-md border border-slate-200 bg-white/95 p-3 text-sm text-slate-700 shadow-xl backdrop-blur"
          >
            <Info class="mt-0.5 h-4 w-4 shrink-0 text-slate-950" />
            <div class="leading-5">{{ state.tutorial }}</div>
            <button
              class="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-950"
              aria-label="Cerrar tutorial"
              type="button"
              @click="closeTutorial"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <aside class="grid content-start gap-4">
        <form class="rounded-md border border-slate-200 bg-white p-4" @submit.prevent="saveZone">
          <h2 class="text-base font-semibold text-slate-950">
            {{ isEditing ? "Editar zona" : "Formulario de zona" }}
          </h2>
          <p class="mt-1 text-sm text-slate-500">
            {{ state.drawing ? `${state.points.length} puntos dibujados` : "Inicia una zona o edita una zona guardada." }}
          </p>

          <div class="mt-4 grid gap-3">
            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Nombre
              <input
                v-model.trim="form.name"
                class="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="Zona Centro"
                required
              />
            </label>

            <label class="grid gap-1.5 text-sm font-medium text-slate-700">
              Tipo
              <select v-model="form.type" class="h-9 rounded-md border border-slate-300 px-3 text-sm">
                <option value="operational">Zona operativa</option>
                <option value="hot_zone">Hot Zone</option>
                <option value="restricted">Restringida</option>
                <option value="pricing_zone">Tarifa por zona</option>
              </select>
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Estado
                <select v-model="form.status" class="h-9 rounded-md border border-slate-300 px-3 text-sm">
                  <option value="active">Activa</option>
                  <option value="inactive">Inactiva</option>
                </select>
              </label>
              <label class="grid gap-1.5 text-sm font-medium text-slate-700">
                Color
                <input v-model="form.color" class="h-9 rounded-md border border-slate-300 px-2" type="color" />
              </label>
            </div>

            <div class="flex gap-2">
              <button
                class="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                :disabled="!canSave"
                type="submit"
              >
                <Save class="h-4 w-4" />
                {{ state.saving ? "Guardando..." : isEditing ? "Actualizar zona" : "Guardar zona" }}
              </button>
              <button
                class="h-9 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
                type="button"
                @click="cancelDrawing"
              >
                Cancelar
              </button>
            </div>
          </div>
        </form>

        <div class="rounded-md border border-slate-200 bg-white p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-base font-semibold text-slate-950">Zonas guardadas</h2>
            <span class="text-sm text-slate-500">{{ state.zones.length }}</span>
          </div>

          <div class="grid max-h-[420px] gap-2 overflow-auto">
            <div
              v-for="zone in state.zones"
              :key="zone.id"
              class="rounded-md border border-slate-200 p-3"
            >
              <div class="flex items-start justify-between gap-3">
                <button class="min-w-0 text-left" type="button" @click="fitZone(zone)">
                  <div class="truncate text-sm font-semibold text-slate-950">{{ zone.name }}</div>
                  <div class="mt-0.5 text-xs text-slate-500">{{ typeLabels[zone.type] || zone.type }} · {{ zone.status }}</div>
                </button>
                <span class="h-4 w-4 shrink-0 rounded-full border border-slate-200" :style="{ backgroundColor: zone.color || '#2563EB' }"></span>
              </div>
              <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>{{ Math.max(0, (zone.coordinates?.length || 1) - 1) }} puntos</span>
                <div class="flex items-center gap-3">
                  <button class="inline-flex items-center gap-1 text-slate-700 hover:text-slate-950" type="button" @click="editZone(zone)">
                    <Edit3 class="h-3.5 w-3.5" />
                    Editar
                  </button>
                  <button class="inline-flex items-center gap-1 text-rose-700 hover:text-rose-900" type="button" @click="requestDeleteZone(zone)">
                    <Trash2 class="h-3.5 w-3.5" />
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
            <div v-if="!state.loading && state.zones.length === 0" class="py-8 text-center text-sm text-slate-500">
              No hay zonas guardadas.
            </div>
            <div v-if="state.loading" class="py-8 text-center text-sm text-slate-500">
              Cargando zonas...
            </div>
          </div>
        </div>
      </aside>
    </div>

    <div
      v-if="state.zonePendingDelete"
      class="fixed inset-0 z-[1200] grid place-items-center bg-slate-950/40 p-4"
      @click.self="cancelDeleteZone"
    >
      <div class="w-full max-w-md rounded-md border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 class="text-lg font-semibold text-slate-950">Eliminar zona</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Esta acción eliminará la zona
          <span class="font-semibold text-slate-950">{{ state.zonePendingDelete.name }}</span>.
          No se puede deshacer.
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            class="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            type="button"
            @click="cancelDeleteZone"
          >
            Cancelar
          </button>
          <button
            class="inline-flex h-9 items-center gap-2 rounded-md bg-rose-700 px-3 text-sm font-medium text-white hover:bg-rose-800"
            type="button"
            @click="confirmDeleteZone"
          >
            <Trash2 class="h-4 w-4" />
            Eliminar
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style>
.zone-vertex {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: var(--zone-color);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.32);
  cursor: grab;
}

.leaflet-dragging .zone-vertex,
.zone-vertex:active {
  cursor: grabbing;
}
</style>
