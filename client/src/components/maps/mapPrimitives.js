import L from "leaflet";

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
