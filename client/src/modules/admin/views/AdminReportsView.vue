<script setup>
import {
  AlertTriangle,
  CalendarDays,
  Car,
  Clock3,
  Copy,
  DollarSign,
  Download,
  MapPinned,
  RefreshCw,
  Star,
  Users,
} from "lucide-vue-next";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, onMounted, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import VChart from "vue-echarts";
import { apiRequest } from "../../../services/api.js";

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const route = useRoute();
const router = useRouter();

const terminalStatuses = [
  "completed",
  "canceled_by_client",
  "canceled_by_driver",
  "canceled_by_system",
  "no_show",
];

const tabs = [
  { key: "resumen", label: "Resumen" },
  { key: "servicios", label: "Servicios" },
  { key: "conductores", label: "Conductores" },
  { key: "clientes", label: "Clientes" },
  { key: "ingresos", label: "Ingresos" },
  { key: "cancelaciones", label: "Cancelaciones" },
];

const serviceLabels = {
  standard: "Taxi",
  premium: "Taxi",
  xl: "Taxi",
  pool: "Taxi",
  package_delivery: "Baúl",
  food_delivery: "Domicilio",
  car_unstuck: "Despinchada",
  jump_start: "Despinchada",
  tire_change: "Despinchada",
};

const state = reactive({
  loading: true,
  error: "",
  rides: [],
  drivers: [],
  clients: [],
  events: [],
  zones: [],
  lastUpdatedAt: null,
});

const filters = reactive({
  tab: resolveRouteTab(),
  from: defaultFrom(),
  to: defaultTo(),
  compareFrom: defaultCompareFrom(),
  compareTo: defaultCompareTo(),
  serviceType: "all",
  zone: "all",
});

function defaultTo() {
  return toInputDate(new Date());
}

function defaultFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return toInputDate(date);
}

function defaultCompareTo() {
  const date = startOfDay(fromInputDate(defaultFrom()));
  date.setDate(date.getDate() - 1);
  return toInputDate(date);
}

function defaultCompareFrom() {
  const date = startOfDay(fromInputDate(defaultFrom()));
  date.setDate(date.getDate() - 7);
  return toInputDate(date);
}

function resolveRouteTab() {
  const view = Array.isArray(route.params.reportView) ? route.params.reportView[0] : route.params.reportView;
  return tabs.some((tab) => tab.key === view) ? view : "resumen";
}

async function fetchReports() {
  state.loading = true;
  state.error = "";

  try {
    const zoneParams = new URLSearchParams({
      from: startDate.value.toISOString(),
      to: endDate.value.toISOString(),
      status: "all",
      serviceType: filters.serviceType,
    });

    const [ridesData, driversData, clientsData, eventsData, hotZonesData] = await Promise.all([
      apiRequest("/api/rides?limit=500&includePassenger=true&includeDriver=true", { method: "GET" }),
      apiRequest("/api/admin/drivers-map", { method: "GET" }),
      apiRequest("/api/admin/users?role=client&limit=200", { method: "GET" }),
      apiRequest("/api/rides/events/recent?limit=200", { method: "GET" }),
      apiRequest(`/api/admin/hot-zones?${zoneParams}`, { method: "GET" }),
    ]);

    state.rides = ridesData?.rides || [];
    state.drivers = driversData?.drivers || [];
    state.clients = clientsData?.users || [];
    state.events = eventsData?.events || [];
    state.zones = hotZonesData?.zones || [];
    state.lastUpdatedAt = new Date().toISOString();
  } catch (err) {
    state.error = err?.message || "No se pudieron cargar los reportes.";
  } finally {
    state.loading = false;
  }
}

function setTab(tabKey) {
  filters.tab = tabs.some((tab) => tab.key === tabKey) ? tabKey : "resumen";
  router.replace(filters.tab === "resumen" ? "/admin/reportes" : `/admin/reportes/${filters.tab}`);
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function fromInputDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function inRange(value, from, to) {
  const ms = parseMs(value);
  return ms !== null && ms >= from.getTime() && ms <= to.getTime();
}

function rideDate(ride) {
  return ride.requestedAt || ride.createdAt || ride.updatedAt;
}

function serviceLabel(code) {
  return serviceLabels[code] || code || "Sin tipo";
}

function fareAmount(ride) {
  return Number(ride.finalFareAmount || ride.estimatedFareAmount || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "-";
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "-";
  const seconds = Math.round(n / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function shortId(id) {
  if (!id) return "-";
  const value = String(id);
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

async function copyText(value) {
  const text = String(value || "");
  if (!text) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (_err) {
    state.error = "No se pudo copiar el ID de la solicitud.";
  }
}

function variation(current, previous) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / previous) * 100;
}

function trendClass(value, inverse = false) {
  if (!value) return "text-slate-500";
  const good = inverse ? value < 0 : value > 0;
  return good ? "text-emerald-600" : "text-rose-600";
}

function trendLabel(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function dayKey(value) {
  return toInputDate(new Date(value));
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function driverName(driver) {
  const contact = driver?.contact || driver || {};
  const name = contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return name || contact.email || shortId(driver?.userId || driver?.id);
}

function clientName(client) {
  const name = client.fullName || [client.firstName, client.lastName].filter(Boolean).join(" ").trim();
  return name || client.email || shortId(client.id);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportReport() {
  const rows = exportRows.value;
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reportes-${filters.tab}-${filters.from}-${filters.to}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const startDate = computed(() => startOfDay(fromInputDate(filters.from)));
const endDate = computed(() => endOfDay(fromInputDate(filters.to)));
const compareStartDate = computed(() => startOfDay(fromInputDate(filters.compareFrom)));
const compareEndDate = computed(() => endOfDay(fromInputDate(filters.compareTo)));

const serviceOptions = computed(() => {
  const values = new Map();
  for (const ride of state.rides) values.set(ride.serviceType || "unknown", serviceLabel(ride.serviceType));
  return Array.from(values.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
});

const zoneOptions = computed(() => state.zones.map((zone) => ({ value: zone.id, label: zone.name })));

const selectedRides = computed(() =>
  state.rides.filter((ride) => {
    if (!inRange(rideDate(ride), startDate.value, endDate.value)) return false;
    if (filters.serviceType !== "all" && ride.serviceType !== filters.serviceType) return false;
    return true;
  }),
);

const comparisonRides = computed(() =>
  state.rides.filter((ride) => {
    if (!inRange(rideDate(ride), compareStartDate.value, compareEndDate.value)) return false;
    if (filters.serviceType !== "all" && ride.serviceType !== filters.serviceType) return false;
    return true;
  }),
);

const completedRides = computed(() => selectedRides.value.filter((ride) => ride.status === "completed"));
const completedComparison = computed(() => comparisonRides.value.filter((ride) => ride.status === "completed"));
const canceledRides = computed(() =>
  selectedRides.value.filter((ride) => String(ride.status || "").startsWith("canceled") || ride.status === "no_show"),
);
const activeRides = computed(() => selectedRides.value.filter((ride) => !terminalStatuses.includes(ride.status)));

const revenue = computed(() => completedRides.value.reduce((sum, ride) => sum + fareAmount(ride), 0));
const revenueComparison = computed(() => completedComparison.value.reduce((sum, ride) => sum + fareAmount(ride), 0));
const averageWaitMs = computed(() => averageDiff(selectedRides.value, "requestedAt", "acceptedAt"));
const averageWaitComparisonMs = computed(() => averageDiff(comparisonRides.value, "requestedAt", "acceptedAt"));

function averageDiff(rides, startKey, endKey) {
  let sum = 0;
  let count = 0;
  for (const ride of rides) {
    const from = parseMs(ride[startKey]);
    const to = parseMs(ride[endKey]);
    if (!from || !to || to < from) continue;
    sum += to - from;
    count += 1;
  }
  return count ? sum / count : null;
}

const kpis = computed(() => [
  {
    label: "Servicios realizados",
    value: completedRides.value.length,
    previous: completedComparison.value.length,
    icon: Car,
    tone: "blue",
  },
  {
    label: "Ingresos totales",
    value: formatCurrency(revenue.value),
    previousValue: revenueComparison.value,
    delta: variation(revenue.value, revenueComparison.value),
    icon: DollarSign,
    tone: "emerald",
  },
  {
    label: "Tiempo prom. de espera",
    value: formatDuration(averageWaitMs.value),
    previousValue: averageWaitComparisonMs.value,
    delta: variation(averageWaitMs.value || 0, averageWaitComparisonMs.value || 0),
    inverse: true,
    icon: Clock3,
    tone: "amber",
  },
  {
    label: "Cancelaciones",
    value: canceledRides.value.length,
    previous: comparisonRides.value.filter((ride) => String(ride.status || "").startsWith("canceled") || ride.status === "no_show").length,
    icon: AlertTriangle,
    tone: "rose",
    inverse: true,
  },
].map((item) => ({
  ...item,
  delta: item.delta ?? variation(Number(item.value || 0), Number(item.previous || 0)),
})));

const dailyRows = computed(() => {
  const days = [];
  const cursor = new Date(startDate.value);
  while (cursor <= endDate.value) {
    const key = dayKey(cursor);
    days.push({ key, label: cursor.toLocaleDateString([], { day: "2-digit", month: "short" }), services: 0, revenue: 0, cancellations: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const byDay = new Map(days.map((day) => [day.key, day]));
  for (const ride of selectedRides.value) {
    const row = byDay.get(dayKey(rideDate(ride)));
    if (!row) continue;
    if (ride.status === "completed") {
      row.services += 1;
      row.revenue += fareAmount(ride);
    }
    if (String(ride.status || "").startsWith("canceled") || ride.status === "no_show") row.cancellations += 1;
  }
  return days;
});

const hourlyRows = computed(() => {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, label: hourLabel(hour), services: 0 }));
  for (const ride of completedRides.value) {
    const ms = parseMs(ride.completedAt || ride.updatedAt || ride.requestedAt);
    if (ms === null) continue;
    rows[new Date(ms).getHours()].services += 1;
  }
  return rows;
});

const servicesByType = computed(() => {
  const counts = new Map();
  for (const ride of completedRides.value) {
    const label = serviceLabel(ride.serviceType);
    const row = counts.get(label) || { label, value: 0, revenue: 0 };
    row.value += 1;
    row.revenue += fareAmount(ride);
    counts.set(label, row);
  }
  return Array.from(counts.values()).sort((a, b) => b.value - a.value);
});

const topZones = computed(() => {
  const rows = state.zones.map((zone) => ({
    name: zone.name,
    services: Number(zone.metrics?.activeRequests || 0),
    drivers: Number(zone.metrics?.availableDrivers || 0),
    waitSeconds: Number(zone.metrics?.averageWaitSeconds || 0),
  }));
  return rows.sort((a, b) => b.services - a.services).slice(0, 5);
});

const driverRows = computed(() => {
  const byDriver = new Map();
  for (const driver of state.drivers) {
    byDriver.set(driver.userId, {
      id: driver.userId,
      name: driverName(driver),
      status: driver.status || "-",
      services: 0,
      revenue: 0,
      rating: Number(driver.rating || 0),
      vehicle: driver.vehicle?.plate || "-",
      online: ["online", "busy"].includes(String(driver.status || "").toLowerCase()),
    });
  }
  for (const ride of completedRides.value) {
    if (!ride.driverId) continue;
    const row = byDriver.get(ride.driverId) || {
      id: ride.driverId,
      name: driverName(ride.driver),
      status: "-",
      services: 0,
      revenue: 0,
      rating: 0,
      vehicle: "-",
      online: false,
    };
    row.services += 1;
    row.revenue += fareAmount(ride);
    byDriver.set(ride.driverId, row);
  }
  return Array.from(byDriver.values()).sort((a, b) => b.services - a.services || b.revenue - a.revenue);
});

const clientRows = computed(() => {
  const byClient = new Map();
  for (const client of state.clients) {
    byClient.set(client.id, {
      id: client.id,
      name: clientName(client),
      email: client.email || "-",
      status: client.status || "-",
      services: 0,
      completed: 0,
      canceled: 0,
      spent: 0,
      rating: Number(client.clientProfile?.rating || 0),
      lastRideAt: null,
    });
  }
  for (const ride of selectedRides.value) {
    if (!ride.clientId) continue;
    const passenger = ride.passenger || ride.client || {};
    const row = byClient.get(ride.clientId) || {
      id: ride.clientId,
      name: clientName(passenger),
      email: passenger.email || "-",
      status: "-",
      services: 0,
      completed: 0,
      canceled: 0,
      spent: 0,
      rating: 0,
      lastRideAt: null,
    };
    row.services += 1;
    if (ride.status === "completed") {
      row.completed += 1;
      row.spent += fareAmount(ride);
    }
    if (String(ride.status || "").startsWith("canceled") || ride.status === "no_show") row.canceled += 1;
    if (!row.lastRideAt || parseMs(rideDate(ride)) > parseMs(row.lastRideAt)) row.lastRideAt = rideDate(ride);
    byClient.set(ride.clientId, row);
  }
  return Array.from(byClient.values()).sort((a, b) => b.services - a.services || b.spent - a.spent);
});

const cancellationRows = computed(() => {
  const labels = {
    canceled_by_client: "Cliente",
    canceled_by_driver: "Conductor",
    canceled_by_system: "Sistema",
    no_show: "No show",
  };
  const counts = new Map(Object.keys(labels).map((key) => [key, { status: key, label: labels[key], value: 0 }]));
  for (const ride of canceledRides.value) {
    const row = counts.get(ride.status);
    if (row) row.value += 1;
  }
  return Array.from(counts.values());
});

const quickSummary = computed(() => {
  const online = state.drivers.filter((driver) => ["online", "busy"].includes(String(driver.status || "").toLowerCase())).length;
  const activeClients = new Set(activeRides.value.map((ride) => ride.clientId).filter(Boolean)).size;
  const ratings = state.drivers.map((driver) => Number(driver.rating)).filter(Boolean);
  const avgRating = ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;
  return [
    { label: "Conductores activos", value: driverRows.value.filter((driver) => driver.services > 0).length, icon: Users },
    { label: "Conductores online", value: online, icon: Car },
    { label: "Clientes activos", value: activeClients, icon: Users },
    { label: "Calificación promedio", value: avgRating ? avgRating.toFixed(2) : "-", icon: Star },
  ];
});

const maxDailyServices = computed(() => Math.max(...dailyRows.value.map((row) => row.services), 1));
const maxHourlyServices = computed(() => Math.max(...hourlyRows.value.map((row) => row.services), 1));
const totalTypeServices = computed(() => servicesByType.value.reduce((sum, row) => sum + row.value, 0));

const baseGrid = {
  left: 42,
  right: 18,
  top: 28,
  bottom: 34,
};

const dailyServicesChart = computed(() => ({
  color: ["#3b82f6"],
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "line" },
    formatter: (params) => {
      const item = params?.[0];
      const row = dailyRows.value[item?.dataIndex] || {};
      return [
        `<strong>${row.label || ""}</strong>`,
        `Servicios finalizados: ${row.services || 0}`,
        `Ingresos: ${formatCurrency(row.revenue || 0)}`,
        `Cancelaciones: ${row.cancellations || 0}`,
      ].join("<br/>");
    },
  },
  grid: baseGrid,
  xAxis: {
    type: "category",
    boundaryGap: false,
    data: dailyRows.value.map((row) => row.label),
    axisTick: { show: false },
  },
  yAxis: {
    type: "value",
    minInterval: 1,
    splitLine: { lineStyle: { color: "#e2e8f0" } },
  },
  series: [
    {
      name: "Servicios",
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 3 },
      areaStyle: { color: "rgba(59,130,246,0.12)" },
      emphasis: { focus: "series", scale: true },
      data: dailyRows.value.map((row) => row.services),
    },
  ],
}));

const servicesByTypeChart = computed(() => ({
  color: ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"],
  tooltip: {
    trigger: "item",
    formatter: (params) => {
      const row = servicesByType.value[params.dataIndex] || {};
      return [
        `<strong>${params.name}</strong>`,
        `Servicios: ${params.value || 0}`,
        `Participación: ${params.percent || 0}%`,
        `Ingresos: ${formatCurrency(row.revenue || 0)}`,
      ].join("<br/>");
    },
  },
  legend: {
    orient: "vertical",
    right: 0,
    top: "middle",
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: "#475569", fontSize: 12 },
  },
  series: [
    {
      name: "Servicios",
      type: "pie",
      radius: ["48%", "72%"],
      center: ["34%", "50%"],
      avoidLabelOverlap: true,
      label: { show: false },
      emphasis: {
        scale: true,
        scaleSize: 8,
        label: { show: true, formatter: "{b}\n{c}" },
      },
      data: servicesByType.value.map((row) => ({ name: row.label, value: row.value })),
    },
  ],
}));

const hourlyServicesChart = computed(() => ({
  color: ["#3b82f6"],
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "shadow" },
    formatter: (params) => {
      const item = params?.[0];
      const row = hourlyRows.value[item?.dataIndex] || {};
      return `<strong>${row.label || ""}</strong><br/>Servicios finalizados: ${row.services || 0}`;
    },
  },
  grid: { left: 36, right: 12, top: 24, bottom: 36 },
  xAxis: {
    type: "category",
    data: hourlyRows.value.map((row) => row.label),
    axisLabel: { interval: 3 },
    axisTick: { show: false },
  },
  yAxis: {
    type: "value",
    minInterval: 1,
    splitLine: { lineStyle: { color: "#e2e8f0" } },
  },
  series: [
    {
      name: "Servicios",
      type: "bar",
      barMaxWidth: 14,
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      emphasis: { itemStyle: { color: "#1d4ed8" } },
      data: hourlyRows.value.map((row) => row.services),
    },
  ],
}));

const topZonesChart = computed(() => ({
  color: ["#60a5fa"],
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "shadow" },
    formatter: (params) => {
      const item = params?.[0];
      const row = topZones.value[item?.dataIndex] || {};
      return [
        `<strong>${row.name || ""}</strong>`,
        `Solicitudes activas: ${row.services || 0}`,
        `Conductores disponibles: ${row.drivers || 0}`,
        `Espera promedio: ${row.waitSeconds ? `${Math.round(row.waitSeconds)}s` : "-"}`,
      ].join("<br/>");
    },
  },
  grid: { left: 82, right: 18, top: 24, bottom: 20 },
  xAxis: {
    type: "value",
    minInterval: 1,
    splitLine: { lineStyle: { color: "#e2e8f0" } },
  },
  yAxis: {
    type: "category",
    data: topZones.value.map((row) => row.name).reverse(),
    axisTick: { show: false },
  },
  series: [
    {
      name: "Demanda",
      type: "bar",
      barMaxWidth: 12,
      itemStyle: { borderRadius: [0, 6, 6, 0] },
      emphasis: { itemStyle: { color: "#2563eb" } },
      data: topZones.value.map((row) => row.services).reverse(),
    },
  ],
}));

const revenueChart = computed(() => ({
  color: ["#22c55e"],
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "shadow" },
    formatter: (params) => {
      const item = params?.[0];
      const row = dailyRows.value[item?.dataIndex] || {};
      return [
        `<strong>${row.label || ""}</strong>`,
        `Ingresos: ${formatCurrency(row.revenue || 0)}`,
        `Servicios: ${row.services || 0}`,
      ].join("<br/>");
    },
  },
  grid: baseGrid,
  xAxis: {
    type: "category",
    data: dailyRows.value.map((row) => row.label),
    axisTick: { show: false },
  },
  yAxis: {
    type: "value",
    axisLabel: { formatter: (value) => formatCurrency(value).replace(",00", "") },
    splitLine: { lineStyle: { color: "#e2e8f0" } },
  },
  series: [
    {
      name: "Ingresos",
      type: "bar",
      barMaxWidth: 32,
      itemStyle: { borderRadius: [6, 6, 0, 0] },
      emphasis: { itemStyle: { color: "#16a34a" } },
      data: dailyRows.value.map((row) => row.revenue),
    },
  ],
}));

const cancellationsChart = computed(() => ({
  color: ["#ef4444", "#f97316", "#64748b", "#a855f7"],
  tooltip: {
    trigger: "item",
    formatter: (params) => `<strong>${params.name}</strong><br/>Cancelaciones: ${params.value || 0}<br/>Participación: ${params.percent || 0}%`,
  },
  legend: {
    bottom: 0,
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: "#475569", fontSize: 12 },
  },
  series: [
    {
      name: "Cancelaciones",
      type: "pie",
      radius: ["42%", "70%"],
      center: ["50%", "42%"],
      label: { formatter: "{b}: {c}" },
      emphasis: { scale: true, scaleSize: 8 },
      data: cancellationRows.value.map((row) => ({ name: row.label, value: row.value })),
    },
  ],
}));

const exportRows = computed(() => {
  if (filters.tab === "conductores") {
    return [["Conductor", "Estado", "Servicios", "Ingresos", "Rating", "Vehículo"], ...driverRows.value.map((row) => [row.name, row.status, row.services, row.revenue, row.rating, row.vehicle])];
  }
  if (filters.tab === "clientes") {
    return [["Cliente", "Email", "Servicios", "Finalizados", "Cancelados", "Gasto", "Último viaje"], ...clientRows.value.map((row) => [row.name, row.email, row.services, row.completed, row.canceled, row.spent, row.lastRideAt])];
  }
  if (filters.tab === "ingresos") {
    return [["Fecha", "Servicios", "Ingresos"], ...dailyRows.value.map((row) => [row.key, row.services, row.revenue])];
  }
  if (filters.tab === "cancelaciones") {
    return [["Tipo", "Cancelaciones"], ...cancellationRows.value.map((row) => [row.label, row.value])];
  }
  return [["Fecha", "Servicios", "Ingresos", "Cancelaciones"], ...dailyRows.value.map((row) => [row.key, row.services, row.revenue, row.cancellations])];
});

watch(
  () => route.params.reportView,
  () => {
    filters.tab = resolveRouteTab();
  },
);

onMounted(fetchReports);
</script>

<template>
  <section class="grid gap-4 p-4">
    <header class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">Reportes</p>
          <h1 class="mt-1 text-2xl font-semibold text-slate-950">Dashboard de reportes</h1>
          <p class="mt-1 text-sm text-slate-500">Métricas construidas desde viajes, conductores, clientes, eventos y zonas reales.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60" :disabled="state.loading" type="button" @click="fetchReports">
            <RefreshCw class="h-4 w-4" />
            Actualizar
          </button>
          <button class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button" @click="exportReport">
            <Download class="h-4 w-4" />
            Exportar
          </button>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2 border-b border-slate-200">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="[
            'border-b-2 px-4 py-2 text-sm font-medium transition',
            filters.tab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-950',
          ]"
          type="button"
          @click="setTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Desde</span>
          <input v-model="filters.from" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950" type="date" />
        </label>
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Hasta</span>
          <input v-model="filters.to" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950" type="date" />
        </label>
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Servicio</span>
          <select v-model="filters.serviceType" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950">
            <option value="all">Todos los servicios</option>
            <option v-for="service in serviceOptions" :key="service.value" :value="service.value">{{ service.label }}</option>
          </select>
        </label>
        <label class="grid gap-1 text-sm text-slate-600">
          <span>Zona</span>
          <select v-model="filters.zone" class="h-9 rounded-md border border-slate-200 px-3 text-slate-950">
            <option value="all">Todas las zonas</option>
            <option v-for="zone in zoneOptions" :key="zone.value" :value="zone.value">{{ zone.label }}</option>
          </select>
        </label>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span class="inline-flex items-center gap-1"><CalendarDays class="h-3.5 w-3.5" /> Comparación: {{ formatDate(filters.compareFrom) }} - {{ formatDate(filters.compareTo) }}</span>
        <span v-if="state.lastUpdatedAt">Actualizado: {{ formatDateTime(state.lastUpdatedAt) }}</span>
      </div>
    </header>

    <div v-if="state.error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {{ state.error }}
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <article v-for="kpi in kpis" :key="kpi.label" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex items-start gap-3">
          <span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-950">
            <component :is="kpi.icon" class="h-5 w-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-slate-500">{{ kpi.label }}</p>
            <div class="mt-1 text-2xl font-semibold text-slate-950">{{ state.loading ? "-" : kpi.value }}</div>
            <div class="mt-1 flex items-center gap-2 text-xs">
              <span :class="trendClass(kpi.delta, kpi.inverse)">{{ trendLabel(kpi.delta) }}</span>
              <span class="text-slate-500">vs periodo anterior</span>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-if="['resumen', 'servicios'].includes(filters.tab)" class="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-slate-950">Servicios por día</h2>
          <span class="text-sm text-slate-500">{{ selectedRides.length }} viajes en el periodo</span>
        </div>
        <div class="h-64">
          <VChart class="h-full w-full" :option="dailyServicesChart" autoresize />
        </div>
      </section>

      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="text-base font-semibold text-slate-950">Servicios por tipo</h2>
        <div class="mt-4 h-64">
          <VChart v-if="servicesByType.length" class="h-full w-full" :option="servicesByTypeChart" autoresize />
          <div v-else-if="!state.loading" class="grid h-full place-items-center text-sm text-slate-500">Sin servicios finalizados.</div>
        </div>
      </section>
    </div>

    <div v-if="filters.tab === 'resumen'" class="grid gap-4 xl:grid-cols-3">
      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="text-base font-semibold text-slate-950">Servicios por hora</h2>
        <div class="mt-4 h-56">
          <VChart class="h-full w-full" :option="hourlyServicesChart" autoresize />
        </div>
      </section>

      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="text-base font-semibold text-slate-950">Top zonas por demanda</h2>
        <div class="mt-4 h-56">
          <VChart v-if="topZones.length" class="h-full w-full" :option="topZonesChart" autoresize />
          <div v-else-if="!state.loading" class="grid h-full place-items-center text-sm text-slate-500">Sin zonas activas.</div>
        </div>
      </section>

      <section class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 class="text-base font-semibold text-slate-950">Resumen rápido</h2>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div v-for="item in quickSummary" :key="item.label" class="rounded-md bg-slate-50 p-3">
            <component :is="item.icon" class="h-5 w-5 text-slate-500" />
            <div class="mt-2 text-sm text-slate-500">{{ item.label }}</div>
            <div class="mt-1 text-xl font-semibold text-slate-950">{{ item.value }}</div>
          </div>
        </div>
      </section>
    </div>

    <section v-if="filters.tab === 'servicios'" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 class="text-base font-semibold text-slate-950">Detalle de servicios</h2>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr><th class="py-2">Servicio</th><th>Estado</th><th>Cliente</th><th>Conductor</th><th>Fecha</th><th class="text-right">Tarifa</th></tr>
          </thead>
          <tbody>
            <tr v-for="ride in selectedRides.slice(0, 80)" :key="ride.id" class="border-b border-slate-100">
              <td class="py-2">
                <div class="flex items-center gap-1">
                  <span class="font-mono text-xs text-slate-600">#{{ shortId(ride.id) }}</span>
                  <button
                    class="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    type="button"
                    title="Copiar ID de solicitud"
                    aria-label="Copiar ID de solicitud"
                    @click="copyText(ride.id)"
                  >
                    <Copy class="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
              <td>{{ ride.status }}</td>
              <td>{{ clientName(ride.passenger || ride.client || {}) }}</td>
              <td>{{ driverName(ride.driver || {}) }}</td>
              <td>{{ formatDateTime(rideDate(ride)) }}</td>
              <td class="text-right font-semibold">{{ formatCurrency(fareAmount(ride)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="filters.tab === 'conductores'" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 class="text-base font-semibold text-slate-950">Reporte de conductores</h2>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr><th class="py-2">Conductor</th><th>Estado</th><th>Vehículo</th><th class="text-right">Servicios</th><th class="text-right">Ingresos</th><th class="text-right">Rating</th></tr>
          </thead>
          <tbody>
            <tr v-for="driver in driverRows.slice(0, 80)" :key="driver.id" class="border-b border-slate-100">
              <td class="py-2 font-medium text-slate-900">{{ driver.name }}</td>
              <td>{{ driver.status }}</td>
              <td>{{ driver.vehicle }}</td>
              <td class="text-right">{{ driver.services }}</td>
              <td class="text-right font-semibold">{{ formatCurrency(driver.revenue) }}</td>
              <td class="text-right">{{ driver.rating || "-" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="filters.tab === 'clientes'" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 class="text-base font-semibold text-slate-950">Reporte de clientes</h2>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full min-w-[820px] text-left text-sm">
          <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr><th class="py-2">Cliente</th><th>Email</th><th class="text-right">Servicios</th><th class="text-right">Finalizados</th><th class="text-right">Cancelados</th><th class="text-right">Gasto</th><th>Último viaje</th></tr>
          </thead>
          <tbody>
            <tr v-for="client in clientRows.slice(0, 80)" :key="client.id" class="border-b border-slate-100">
              <td class="py-2 font-medium text-slate-900">{{ client.name }}</td>
              <td>{{ client.email }}</td>
              <td class="text-right">{{ client.services }}</td>
              <td class="text-right">{{ client.completed }}</td>
              <td class="text-right">{{ client.canceled }}</td>
              <td class="text-right font-semibold">{{ formatCurrency(client.spent) }}</td>
              <td>{{ formatDateTime(client.lastRideAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="filters.tab === 'ingresos'" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 class="text-base font-semibold text-slate-950">Ingresos por día</h2>
      <div class="mt-4 h-80">
        <VChart class="h-full w-full" :option="revenueChart" autoresize />
      </div>
    </section>

    <section v-if="filters.tab === 'cancelaciones'" class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 class="text-base font-semibold text-slate-950">Cancelaciones por tipo</h2>
      <div class="mt-4 h-80">
        <VChart v-if="canceledRides.length" class="h-full w-full" :option="cancellationsChart" autoresize />
        <div v-else-if="!state.loading" class="grid h-full place-items-center text-sm text-slate-500">Sin cancelaciones en el periodo.</div>
      </div>
    </section>

    <footer class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span>Los datos se calculan desde endpoints reales disponibles del backend.</span>
      <span>Hora actual: {{ formatDateTime(new Date().toISOString()) }}</span>
    </footer>
  </section>
</template>
