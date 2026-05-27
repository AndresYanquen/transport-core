<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { apiRequest } from "../../../services/api.js";
import DebugGeoMap from "../components/DebugGeoMap.vue";

const state = reactive({
  loading: true,
  error: "",
  lastUpdatedAt: null,
  payload: null,
});

const filters = reactive({
  search: "",
  rideStatus: "any",
  driverStatus: "any",
  activeOnly: true,
  stuckOnly: false,
});

const pollingMs = ref(2000);
let timer = null;
let inFlight = false;

const STUCK_THRESHOLDS_MS = Object.freeze({
  pending_driver: 2 * 60 * 1000,
  driver_assigned: 3 * 60 * 1000,
  driver_en_route: 10 * 60 * 1000,
  driver_arrived: 5 * 60 * 1000,
  in_progress: 45 * 60 * 1000,
  gps_silent: 30 * 1000,
});

function nowMs() {
  return Date.now();
}

function parseMs(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isTerminalRideStatus(s) {
  return ["completed", "canceled_by_client", "canceled_by_driver", "canceled_by_system", "no_show"].includes(s);
}

function isStuckRide(ride, driversById) {
  const status = ride?.status;
  if (!status || isTerminalRideStatus(status)) return false;

  const updatedAt = parseMs(ride?.updatedAt) ?? parseMs(ride?.requestedAt);
  if (!updatedAt) return false;

  const age = nowMs() - updatedAt;
  const threshold = STUCK_THRESHOLDS_MS[status];
  const stuckByStatus = threshold ? age >= threshold : false;

  let stuckByGps = false;
  if (ride?.driverId) {
    const d = driversById.get(ride.driverId);
    const dUpdatedAt = parseMs(d?.updatedAt);
    if (dUpdatedAt && nowMs() - dUpdatedAt >= STUCK_THRESHOLDS_MS.gps_silent) {
      stuckByGps = true;
    }
  }

  return stuckByStatus || stuckByGps;
}

async function fetchState() {
  if (inFlight) return;
  inFlight = true;
  state.error = "";

  try {
    const data = await apiRequest("/api/admin/simulation/state?limit=300", {
      method: "GET",
      auth: false,
    });
    state.payload = data;
    state.lastUpdatedAt = new Date().toISOString();
    state.loading = false;
  } catch (err) {
    state.error = err?.message || "Failed to load state";
    state.loading = false;
  } finally {
    inFlight = false;
  }
}

function start() {
  if (timer) return;
  timer = window.setInterval(fetchState, pollingMs.value);
}

function stop() {
  if (!timer) return;
  window.clearInterval(timer);
  timer = null;
}

onMounted(async () => {
  await fetchState();
  start();
});

onBeforeUnmount(() => {
  stop();
});

const drivers = computed(() => state.payload?.drivers || []);
const rides = computed(() => state.payload?.rides || []);
const recentEvents = computed(() => state.payload?.recentEvents || []);
const metrics = computed(() => state.payload?.metrics || null);
const server = computed(() => state.payload?.server || null);

const driversById = computed(() => {
  const map = new Map();
  for (const d of drivers.value) map.set(d.userId, d);
  return map;
});

const filteredDrivers = computed(() => {
  const q = filters.search.trim().toLowerCase();
  return drivers.value.filter((d) => {
    if (filters.driverStatus !== "any" && d.status !== filters.driverStatus) return false;
    if (!q) return true;
    return (
      String(d.userId || "").toLowerCase().includes(q) ||
      String(d.contact?.email || "").toLowerCase().includes(q)
    );
  });
});

const filteredRides = computed(() => {
  const q = filters.search.trim().toLowerCase();
  return rides.value.filter((r) => {
    if (filters.rideStatus !== "any" && r.status !== filters.rideStatus) return false;
    if (filters.activeOnly && isTerminalRideStatus(r.status)) return false;
    if (filters.stuckOnly && !isStuckRide(r, driversById.value)) return false;
    if (!q) return true;
    return (
      String(r.id || "").toLowerCase().includes(q) ||
      String(r.clientId || "").toLowerCase().includes(q) ||
      String(r.driverId || "").toLowerCase().includes(q) ||
      String(r.client?.email || "").toLowerCase().includes(q) ||
      String(r.driver?.email || "").toLowerCase().includes(q)
    );
  });
});

const rideStatuses = computed(() => {
  const set = new Set(rides.value.map((r) => r.status).filter(Boolean));
  return ["any", ...Array.from(set).sort()];
});

function shortId(id) {
  if (!id) return "";
  const s = String(id);
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "-";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  if (n < 1000) return `${Math.round(n)}ms`;
  const sec = Math.round(n / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function rideDurationMs(r) {
  const started = parseMs(r?.startedAt);
  if (!started) return null;
  return Math.max(0, nowMs() - started);
}

function assignmentMs(r) {
  const a = parseMs(r?.acceptedAt);
  const req = parseMs(r?.requestedAt);
  if (!a || !req) return null;
  return Math.max(0, a - req);
}

const stuckRideCount = computed(() => filteredRides.value.filter((r) => isStuckRide(r, driversById.value)).length);
</script>

<template>
  <div class="mx-auto max-w-[1400px] p-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold text-slate-900">Admin Simulation</h1>
        <span class="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
          /admin/simulation
        </span>
      </div>

      <div class="flex items-center gap-2 text-xs text-slate-600">
        <span class="font-mono">poll={{ pollingMs }}ms</span>
        <span v-if="server" class="font-mono">realtime={{ server.realtimeEnabled ? "on" : "off" }}</span>
        <span v-if="state.lastUpdatedAt" class="font-mono">updated={{ new Date(state.lastUpdatedAt).toLocaleTimeString() }}</span>
        <button
          class="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
          @click="fetchState"
        >
          Refresh
        </button>
      </div>
    </div>

    <div v-if="state.error" class="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div class="lg:col-span-2">
        <DebugGeoMap :drivers="filteredDrivers" :rides="filteredRides" :height="420" />
      </div>

      <div class="rounded border border-slate-200 bg-white p-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="text-xs font-mono text-slate-700">Metrics</div>
          <div class="text-[11px] font-mono text-slate-500">
            stuck={{ stuckRideCount }}
          </div>
        </div>

        <div v-if="!metrics" class="text-sm text-slate-600">Loading...</div>

        <div v-else class="grid grid-cols-2 gap-2 text-xs">
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">drivers.total</div>
            <div class="font-mono text-slate-900">{{ metrics.drivers.total }}</div>
          </div>
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">drivers.online</div>
            <div class="font-mono text-slate-900">{{ metrics.drivers.online }}</div>
          </div>
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">drivers.available</div>
            <div class="font-mono text-slate-900">{{ metrics.drivers.available }}</div>
          </div>
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">drivers.busy</div>
            <div class="font-mono text-slate-900">{{ metrics.drivers.busy }}</div>
          </div>

          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">rides.pending_driver</div>
            <div class="font-mono text-slate-900">{{ metrics.rides.counts.pending_driver || 0 }}</div>
          </div>
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">rides.in_progress</div>
            <div class="font-mono text-slate-900">{{ metrics.rides.counts.in_progress || 0 }}</div>
          </div>
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">rides.completed</div>
            <div class="font-mono text-slate-900">{{ metrics.rides.counts.completed || 0 }}</div>
          </div>
          <div class="rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">rides.cancelled</div>
            <div class="font-mono text-slate-900">
              {{
                (metrics.rides.counts.canceled_by_client || 0) +
                (metrics.rides.counts.canceled_by_driver || 0) +
                (metrics.rides.counts.canceled_by_system || 0)
              }}
            </div>
          </div>

          <div class="col-span-2 rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">rides.avgAssignmentMs</div>
            <div class="font-mono text-slate-900">{{ fmtMs(metrics.rides.avgAssignmentMs) }}</div>
          </div>

          <div class="col-span-2 rounded border border-slate-100 p-2">
            <div class="font-mono text-slate-500">gps.updatesLastMinute (approx)</div>
            <div class="font-mono text-slate-900">{{ metrics.gps.updatesLastMinute }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div class="rounded border border-slate-200 bg-white p-3 lg:col-span-2">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs font-mono text-slate-700">Active Rides</div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <input
              v-model="filters.search"
              class="w-64 rounded border border-slate-200 px-2 py-1 font-mono text-xs"
              placeholder="search rideId / driverId / customerId / email"
            />
            <select v-model="filters.rideStatus" class="rounded border border-slate-200 px-2 py-1 font-mono text-xs">
              <option v-for="s in rideStatuses" :key="s" :value="s">{{ s }}</option>
            </select>
            <label class="flex items-center gap-1 font-mono text-xs text-slate-700">
              <input type="checkbox" v-model="filters.activeOnly" />
              activeOnly
            </label>
            <label class="flex items-center gap-1 font-mono text-xs text-slate-700">
              <input type="checkbox" v-model="filters.stuckOnly" />
              stuckOnly
            </label>
          </div>
        </div>

        <div class="overflow-auto">
          <table class="w-full border-collapse text-xs">
            <thead class="sticky top-0 bg-white">
              <tr class="border-b border-slate-100 text-left font-mono text-slate-500">
                <th class="py-2 pr-2">rideId</th>
                <th class="py-2 pr-2">status</th>
                <th class="py-2 pr-2">client</th>
                <th class="py-2 pr-2">driver</th>
                <th class="py-2 pr-2">assign</th>
                <th class="py-2 pr-2">created</th>
                <th class="py-2 pr-2">updated</th>
                <th class="py-2 pr-2">duration</th>
                <th class="py-2 pr-2">stuck</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in filteredRides"
                :key="r.id"
                class="border-b border-slate-50 font-mono text-slate-800"
              >
                <td class="py-2 pr-2">{{ shortId(r.id) }}</td>
                <td class="py-2 pr-2">{{ r.status }}</td>
                <td class="py-2 pr-2">{{ shortId(r.clientId) }}</td>
                <td class="py-2 pr-2">{{ r.driverId ? shortId(r.driverId) : "-" }}</td>
                <td class="py-2 pr-2">{{ fmtMs(assignmentMs(r)) }}</td>
                <td class="py-2 pr-2">{{ r.requestedAt ? new Date(r.requestedAt).toLocaleTimeString() : "-" }}</td>
                <td class="py-2 pr-2">{{ r.updatedAt ? new Date(r.updatedAt).toLocaleTimeString() : "-" }}</td>
                <td class="py-2 pr-2">{{ fmtMs(rideDurationMs(r)) }}</td>
                <td class="py-2 pr-2">
                  <span v-if="isStuckRide(r, driversById)" class="rounded bg-amber-100 px-2 py-0.5 text-amber-800">stuck</span>
                  <span v-else class="text-slate-400">ok</span>
                </td>
              </tr>
              <tr v-if="filteredRides.length === 0">
                <td colspan="9" class="py-6 text-center text-sm text-slate-500">No rides</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rounded border border-slate-200 bg-white p-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="text-xs font-mono text-slate-700">Recent Events (ride_events)</div>
          <div class="text-[11px] font-mono text-slate-500">{{ recentEvents.length }}</div>
        </div>
        <div class="max-h-[420px] overflow-auto">
          <div
            v-for="e in recentEvents"
            :key="e.id"
            class="border-b border-slate-50 py-2 font-mono text-xs text-slate-700"
          >
            <div class="flex items-center justify-between">
              <div class="text-slate-900">{{ e.status }}</div>
              <div class="text-slate-400">{{ e.occurredAt ? new Date(e.occurredAt).toLocaleTimeString() : "-" }}</div>
            </div>
            <div class="text-slate-500">ride={{ shortId(e.rideId) }} actor={{ e.actorType }}</div>
          </div>
          <div v-if="recentEvents.length === 0" class="py-6 text-center text-sm text-slate-500">No events</div>
        </div>
      </div>
    </div>

    <div class="mt-3 rounded border border-slate-200 bg-white p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs font-mono text-slate-700">Drivers</div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <select v-model="filters.driverStatus" class="rounded border border-slate-200 px-2 py-1 font-mono text-xs">
            <option value="any">any</option>
            <option value="online">online</option>
            <option value="offline">offline</option>
          </select>
          <span class="font-mono text-[11px] text-slate-500">showing={{ filteredDrivers.length }}</span>
        </div>
      </div>

      <div class="overflow-auto">
        <table class="w-full border-collapse text-xs">
          <thead class="sticky top-0 bg-white">
            <tr class="border-b border-slate-100 text-left font-mono text-slate-500">
              <th class="py-2 pr-2">driverId</th>
              <th class="py-2 pr-2">status</th>
              <th class="py-2 pr-2">currentRide</th>
              <th class="py-2 pr-2">lastGPS</th>
              <th class="py-2 pr-2">lat</th>
              <th class="py-2 pr-2">lng</th>
              <th class="py-2 pr-2">simUser</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in filteredDrivers" :key="d.userId" class="border-b border-slate-50 font-mono text-slate-800">
              <td class="py-2 pr-2">{{ shortId(d.userId) }}</td>
              <td class="py-2 pr-2">{{ d.status }}</td>
              <td class="py-2 pr-2">{{ d.currentRideId ? shortId(d.currentRideId) : "-" }}</td>
              <td class="py-2 pr-2">{{ d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString() : "-" }}</td>
              <td class="py-2 pr-2">{{ d.currentLocation?.lat?.toFixed?.(5) || "-" }}</td>
              <td class="py-2 pr-2">{{ d.currentLocation?.lng?.toFixed?.(5) || "-" }}</td>
              <td class="py-2 pr-2">
                <span v-if="d.isSimUser" class="rounded bg-slate-100 px-2 py-0.5 text-slate-700">sim</span>
                <span v-else class="text-slate-400">-</span>
              </td>
            </tr>
            <tr v-if="filteredDrivers.length === 0">
              <td colspan="7" class="py-6 text-center text-sm text-slate-500">No drivers</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="mt-3 rounded border border-slate-200 bg-white p-3">
      <div class="mb-1 text-xs font-mono text-slate-700">Simulation Control (read-only)</div>
      <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div class="rounded border border-slate-100 p-2">
          <div class="font-mono text-slate-500">simulation.running</div>
          <div class="font-mono text-slate-900">unknown</div>
        </div>
        <div class="rounded border border-slate-100 p-2">
          <div class="font-mono text-slate-500">simulation.simulatedDrivers</div>
          <div class="font-mono text-slate-900">{{ metrics?.simulation?.simulatedDrivers ?? "-" }}</div>
        </div>
        <div class="rounded border border-slate-100 p-2">
          <div class="font-mono text-slate-500">simulation.chaosMode</div>
          <div class="font-mono text-slate-900">unknown</div>
        </div>
      </div>
      <div class="mt-2 text-[11px] text-slate-500">
        Note: to control the simulator (start/stop/rates), do it via the simulator process/env vars. This panel is for visibility only.
      </div>
    </div>
  </div>
</template>
