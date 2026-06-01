<script setup>
import { Maximize2, Minus, Minimize2, Plus, RotateCcw } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

const props = defineProps({
  drivers: { type: Array, default: () => [] },
  rides: { type: Array, default: () => [] },
  height: { type: Number, default: 420 },
});

const isFullscreen = ref(false);
const zoomOffset = ref(0);
const isDragging = ref(false);
const pan = reactive({
  x: 0,
  y: 0,
});
const dragStart = reactive({
  x: 0,
  y: 0,
});
const viewport = reactive({
  width: 900,
  height: props.height,
});

const minZoom = 3;
const maxZoom = 18;

function updateViewport() {
  if (typeof window === "undefined") return;
  viewport.width = Math.max(360, window.innerWidth);
  viewport.height = Math.max(360, window.innerHeight);
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value;
  updateViewport();
}

function onKeydown(event) {
  if (event.key === "Escape" && isFullscreen.value) {
    isFullscreen.value = false;
  }
}

function zoomIn() {
  if (mapZoom.value >= maxZoom) return;
  zoomOffset.value += 1;
}

function zoomOut() {
  if (mapZoom.value <= minZoom) return;
  zoomOffset.value -= 1;
}

function resetZoom() {
  zoomOffset.value = 0;
  resetPan();
}

function resetPan() {
  pan.x = 0;
  pan.y = 0;
}

function startDrag(event) {
  if (event.button !== 0) return;
  isDragging.value = true;
  dragStart.x = event.clientX;
  dragStart.y = event.clientY;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function dragMap(event) {
  if (!isDragging.value) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  pan.x += dx;
  pan.y += dy;
  dragStart.x = event.clientX;
  dragStart.y = event.clientY;
}

function stopDrag(event) {
  isDragging.value = false;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
}

onMounted(() => {
  updateViewport();
  window.addEventListener("resize", updateViewport);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateViewport);
  window.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});

watch(isFullscreen, (value) => {
  document.body.style.overflow = value ? "hidden" : "";
});

function isFiniteNum(n) {
  return Number.isFinite(Number(n));
}

function pickPoints() {
  const pts = [];
  for (const d of props.drivers) {
    const p = d?.currentLocation;
    if (p && isFiniteNum(p.lat) && isFiniteNum(p.lng)) {
      pts.push({ lat: Number(p.lat), lng: Number(p.lng), type: "driver" });
    }
  }
  for (const r of props.rides) {
    const p1 = r?.pickupLocation;
    if (p1 && isFiniteNum(p1.lat) && isFiniteNum(p1.lng)) {
      pts.push({ lat: Number(p1.lat), lng: Number(p1.lng), type: "pickup" });
    }
    const p2 = r?.dropoffLocation;
    if (p2 && isFiniteNum(p2.lat) && isFiniteNum(p2.lng)) {
      pts.push({ lat: Number(p2.lat), lng: Number(p2.lng), type: "dropoff" });
    }
  }
  return pts;
}

function clampLat(lat) {
  return Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
}

function lonLatToWorld({ lat, lng }, zoom) {
  const scale = 256 * 2 ** zoom;
  const safeLat = clampLat(lat);
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((Number(lng) + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function tileUrl(x, y, z) {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

const bounds = computed(() => {
  const pts = pickPoints();
  if (!pts.length) {
    // Tunja-ish defaults
    return { minLat: 5.50, maxLat: 5.57, minLng: -73.41, maxLng: -73.33 };
  }
  let minLat = pts[0].lat, maxLat = pts[0].lat, minLng = pts[0].lng, maxLng = pts[0].lng;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  // pad a bit
  const padLat = (maxLat - minLat) * 0.1 || 0.002;
  const padLng = (maxLng - minLng) * 0.1 || 0.002;
  return {
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  };
});

function driverColor(d) {
  if (d?.status !== "online") return "rgba(148,163,184,0.8)"; // slate
  if (d?.currentRideId) return "rgba(239,68,68,0.9)"; // red
  return "rgba(34,197,94,0.9)"; // green
}

function rideColor(r) {
  const s = r?.status;
  if (!s) return "rgba(148,163,184,0.7)";
  if (String(s).startsWith("canceled") || s === "no_show") return "rgba(148,163,184,0.7)";
  if (s === "completed") return "rgba(16,185,129,0.7)";
  if (s === "pending_driver" || s === "requested") return "rgba(59,130,246,0.7)";
  return "rgba(245,158,11,0.8)";
}

const svgWidth = computed(() => (isFullscreen.value ? viewport.width : 900));
const svgHeight = computed(() => (isFullscreen.value ? Math.max(320, viewport.height - 82) : props.height));
const tileSize = 256;

const mapCenter = computed(() => ({
  lat: (bounds.value.minLat + bounds.value.maxLat) / 2,
  lng: (bounds.value.minLng + bounds.value.maxLng) / 2,
}));

const autoMapZoom = computed(() => {
  const b = bounds.value;
  for (let z = maxZoom; z >= minZoom; z -= 1) {
    const nw = lonLatToWorld({ lat: b.maxLat, lng: b.minLng }, z);
    const se = lonLatToWorld({ lat: b.minLat, lng: b.maxLng }, z);
    const spanX = Math.abs(se.x - nw.x);
    const spanY = Math.abs(se.y - nw.y);
    if (spanX <= svgWidth.value * 0.82 && spanY <= svgHeight.value * 0.82) return z;
  }
  return minZoom;
});

const mapZoom = computed(() => {
  return Math.max(minZoom, Math.min(maxZoom, autoMapZoom.value + zoomOffset.value));
});

const centerWorld = computed(() => lonLatToWorld(mapCenter.value, mapZoom.value));

function project({ lat, lng }) {
  const world = lonLatToWorld({ lat, lng }, mapZoom.value);
  return {
    x: world.x - centerWorld.value.x + svgWidth.value / 2 + pan.x,
    y: world.y - centerWorld.value.y + svgHeight.value / 2 + pan.y,
  };
}

const visibleTiles = computed(() => {
  const z = mapZoom.value;
  const tilesPerSide = 2 ** z;
  const minX = centerWorld.value.x - svgWidth.value / 2 - pan.x;
  const maxX = centerWorld.value.x + svgWidth.value / 2 - pan.x;
  const minY = centerWorld.value.y - svgHeight.value / 2 - pan.y;
  const maxY = centerWorld.value.y + svgHeight.value / 2 - pan.y;
  const startX = Math.floor(minX / tileSize);
  const endX = Math.floor(maxX / tileSize);
  const startY = Math.max(0, Math.floor(minY / tileSize));
  const endY = Math.min(tilesPerSide - 1, Math.floor(maxY / tileSize));
  const tiles = [];

  for (let x = startX; x <= endX; x += 1) {
    const wrappedX = ((x % tilesPerSide) + tilesPerSide) % tilesPerSide;
    for (let y = startY; y <= endY; y += 1) {
      tiles.push({
        key: `${z}-${x}-${y}`,
        href: tileUrl(wrappedX, y, z),
        x: x * tileSize - minX,
        y: y * tileSize - minY,
      });
    }
  }

  return tiles;
});

const projectedRides = computed(() => {
  return props.rides.map((r) => {
    const pickup = r?.pickupLocation;
    const dropoff = r?.dropoffLocation;
    const pickupP = pickup ? project(pickup) : null;
    const dropoffP = dropoff ? project(dropoff) : null;
    return { r, pickupP, dropoffP };
  });
});

const projectedDrivers = computed(() => {
  return props.drivers
    .filter((d) => d?.currentLocation && isFiniteNum(d.currentLocation.lat) && isFiniteNum(d.currentLocation.lng))
    .map((d) => {
      const { x, y } = project(d.currentLocation);
      return { d, x, y };
    });
});

const livePointCount = computed(() => pickPoints().length);
</script>

<template>
  <div
    :class="[
      'bg-white',
      isFullscreen
        ? 'fixed inset-0 z-50 flex h-screen w-screen flex-col rounded-none border-0'
        : 'rounded border border-slate-200',
    ]"
  >
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs">
      <div class="font-mono text-slate-700">Geo Debug Map</div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <div class="font-mono text-slate-500">
          points={{ livePointCount }} | z={{ mapZoom }} |
          lat {{ bounds.minLat.toFixed(4) }}..{{ bounds.maxLat.toFixed(4) }} |
          lng {{ bounds.minLng.toFixed(4) }}..{{ bounds.maxLng.toFixed(4) }}
        </div>
        <div class="inline-flex overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="mapZoom <= minZoom"
            aria-label="Zoom out map"
            title="Zoom out"
            @click="zoomOut"
          >
            <Minus class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center border-x border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="zoomOffset === 0"
            aria-label="Reset map zoom"
            title="Reset zoom"
            @click="resetZoom"
          >
            <RotateCcw class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="mapZoom >= maxZoom"
            aria-label="Zoom in map"
            title="Zoom in"
            @click="zoomIn"
          >
            <Plus class="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
          :aria-label="isFullscreen ? 'Exit fullscreen map' : 'Open fullscreen map'"
          :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="toggleFullscreen"
        >
          <Minimize2 v-if="isFullscreen" class="h-4 w-4" />
          <Maximize2 v-else class="h-4 w-4" />
        </button>
      </div>
    </div>
    <div :class="['p-2', isFullscreen ? 'flex min-h-0 flex-1 flex-col' : '']">
      <svg
        :width="svgWidth"
        :height="svgHeight"
        :class="[
          'h-auto w-full touch-none select-none rounded bg-slate-100',
          isDragging ? 'cursor-grabbing' : 'cursor-grab',
        ]"
        @pointerdown="startDrag"
        @pointermove="dragMap"
        @pointerup="stopDrag"
        @pointercancel="stopDrag"
        @pointerleave="stopDrag"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.25)" stroke-width="1" />
          </pattern>
          <filter id="markerShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="rgba(15,23,42,0.35)" />
          </filter>
        </defs>
        <g>
          <image
            v-for="tile in visibleTiles"
            :key="tile.key"
            :href="tile.href"
            :x="tile.x"
            :y="tile.y"
            :width="tileSize"
            :height="tileSize"
            preserveAspectRatio="none"
          />
        </g>
        <rect x="0" y="0" :width="svgWidth" :height="svgHeight" fill="url(#grid)" opacity="0.45" />

        <g v-for="pr in projectedRides" :key="pr.r?.id">
          <line
            v-if="pr.pickupP && pr.dropoffP"
            :x1="pr.pickupP.x"
            :y1="pr.pickupP.y"
            :x2="pr.dropoffP.x"
            :y2="pr.dropoffP.y"
            :stroke="rideColor(pr.r)"
            stroke-width="2"
            stroke-dasharray="6 4"
          />
          <circle
            v-if="pr.pickupP"
            :cx="pr.pickupP.x"
            :cy="pr.pickupP.y"
            r="5"
            fill="rgba(59,130,246,0.9)"
            stroke="white"
            stroke-width="2"
            filter="url(#markerShadow)"
          />
          <circle
            v-if="pr.dropoffP"
            :cx="pr.dropoffP.x"
            :cy="pr.dropoffP.y"
            r="5"
            fill="rgba(245,158,11,0.9)"
            stroke="white"
            stroke-width="2"
            filter="url(#markerShadow)"
          />
        </g>

        <g v-for="pd in projectedDrivers" :key="pd.d?.userId">
          <circle
            :cx="pd.x"
            :cy="pd.y"
            r="6"
            :fill="driverColor(pd.d)"
            stroke="white"
            stroke-width="2"
            filter="url(#markerShadow)"
          />
        </g>
      </svg>

      <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600 sm:grid-cols-4">
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
          <span>Driver available</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
          <span>Driver busy</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full bg-slate-400"></span>
          <span>Driver offline</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
          <span>Pickup</span>
        </div>
      </div>
    </div>
  </div>
</template>
