<script setup>
import { computed } from "vue";

const props = defineProps({
  drivers: { type: Array, default: () => [] },
  rides: { type: Array, default: () => [] },
  height: { type: Number, default: 420 },
});

function isFiniteNum(n) {
  return Number.isFinite(Number(n));
}

function pickPoints() {
  const pts = [];
  for (const d of props.drivers) {
    const p = d?.currentLocation;
    if (p && isFiniteNum(p.lat) && isFiniteNum(p.lng)) pts.push({ lat: Number(p.lat), lng: Number(p.lng) });
  }
  for (const r of props.rides) {
    const p1 = r?.pickupLocation;
    if (p1 && isFiniteNum(p1.lat) && isFiniteNum(p1.lng)) pts.push({ lat: Number(p1.lat), lng: Number(p1.lng) });
    const p2 = r?.dropoffLocation;
    if (p2 && isFiniteNum(p2.lat) && isFiniteNum(p2.lng)) pts.push({ lat: Number(p2.lat), lng: Number(p2.lng) });
  }
  return pts;
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

function project({ lat, lng }, width, height) {
  const b = bounds.value;
  const x = (lng - b.minLng) / (b.maxLng - b.minLng);
  const y = 1 - (lat - b.minLat) / (b.maxLat - b.minLat);
  return {
    x: Math.max(0, Math.min(1, x)) * width,
    y: Math.max(0, Math.min(1, y)) * height,
  };
}

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

const svgWidth = 900;
const svgHeight = computed(() => props.height);

const projectedDrivers = computed(() => {
  return props.drivers
    .filter((d) => d?.currentLocation)
    .map((d) => {
      const { x, y } = project(d.currentLocation, svgWidth, svgHeight.value);
      return { d, x, y };
    });
});

const projectedRides = computed(() => {
  return props.rides.map((r) => {
    const pickup = r?.pickupLocation;
    const dropoff = r?.dropoffLocation;
    const pickupP = pickup ? project(pickup, svgWidth, svgHeight.value) : null;
    const dropoffP = dropoff ? project(dropoff, svgWidth, svgHeight.value) : null;
    return { r, pickupP, dropoffP };
  });
});
</script>

<template>
  <div class="rounded border border-slate-200 bg-white">
    <div class="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs">
      <div class="font-mono text-slate-700">Geo Debug Map (normalized)</div>
      <div class="font-mono text-slate-500">
        lat {{ bounds.minLat.toFixed(4) }}..{{ bounds.maxLat.toFixed(4) }} |
        lng {{ bounds.minLng.toFixed(4) }}..{{ bounds.maxLng.toFixed(4) }}
      </div>
    </div>
    <div class="p-2">
      <svg :width="svgWidth" :height="svgHeight" class="h-auto w-full rounded bg-slate-50">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.25)" stroke-width="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" :width="svgWidth" :height="svgHeight" fill="url(#grid)" />

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
            r="4"
            fill="rgba(59,130,246,0.9)"
          />
          <circle
            v-if="pr.dropoffP"
            :cx="pr.dropoffP.x"
            :cy="pr.dropoffP.y"
            r="4"
            fill="rgba(245,158,11,0.9)"
          />
        </g>

        <g v-for="pd in projectedDrivers" :key="pd.d?.userId">
          <circle :cx="pd.x" :cy="pd.y" r="5" :fill="driverColor(pd.d)" />
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

