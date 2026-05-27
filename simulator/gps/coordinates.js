const { randFloat } = require("../utils/random");

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

function calculateDistanceKm(a, b) {
  const R = 6371;
  const dLat = degToRad(b.lat - a.lat);
  const dLng = degToRad(b.lng - a.lng);
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * R * Math.asin(Math.sqrt(h));
}

function randomLocationAroundCenter({ centerLat, centerLng, radiusKm }) {
  const radiusDeg = radiusKm / 111;
  const u = Math.random();
  const v = Math.random();
  const w = radiusDeg * Math.sqrt(u);
  const t = 2 * Math.PI * v;

  const lat = centerLat + w * Math.sin(t);
  const lng = centerLng + (w * Math.cos(t)) / Math.cos(degToRad(centerLat));

  return { lat, lng };
}

function interpolateLocation(start, end, progress) {
  const p = Math.max(0, Math.min(1, progress));
  return {
    lat: start.lat + (end.lat - start.lat) * p,
    lng: start.lng + (end.lng - start.lng) * p,
  };
}

function generateRoutePoints(start, end, steps = 20) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    pts.push(interpolateLocation(start, end, i / steps));
  }
  return pts;
}

function jitter(location, meters = 15) {
  const metersPerDegLat = 111_000;
  const metersPerDegLng = 111_000 * Math.cos(degToRad(location.lat));

  const dLat = randFloat(-meters, meters) / metersPerDegLat;
  const dLng = randFloat(-meters, meters) / metersPerDegLng;

  return {
    lat: location.lat + dLat,
    lng: location.lng + dLng,
  };
}

module.exports = {
  calculateDistanceKm,
  randomLocationAroundCenter,
  interpolateLocation,
  generateRoutePoints,
  jitter,
};

