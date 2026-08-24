import L from "leaflet";

const stadiaTileUrl = import.meta.env.VITE_STADIA_TILE_URL || (
  import.meta.env.VITE_STADIA_API_KEY
    ? `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY}`
    : "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png"
);

export const mapTileOptions = {
  attribution:
    '&copy; <a href="https://www.stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
};

export function addBaseTileLayer(map, options = {}) {
  return L.tileLayer(stadiaTileUrl, { ...mapTileOptions, ...options }).addTo(map);
}

export function mapTileUrl(x, y, z) {
  return stadiaTileUrl
    .replace("{x}", x)
    .replace("{y}", y)
    .replace("{z}", z)
    .replace("{r}", "");
}

export function escapeMapHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createDriverMarkerIcon(driver, { muted = false } = {}) {
  const heading = Number(driver?.headingDegrees || 0);
  return L.divIcon({
    className: "",
    html: `<span class="hot-driver-marker ${muted ? "hot-driver-marker--muted" : "hot-driver-marker--highlighted"}"><span style="transform:rotate(${heading}deg)"></span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export function createRequestMarkerIcon(request) {
  const color = request?.serviceColor || "#7c3aed";
  return L.divIcon({
    className: "",
    html: `<span class="hot-request-marker" style="--request-color:${color}"><span></span></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export function shortMapId(value) {
  return String(value || "").slice(0, 8).toUpperCase();
}
