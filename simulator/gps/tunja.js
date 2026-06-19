const TUNJA_CENTER = {
  lat: 5.535,
  lng: -73.367,
};

const TUNJA_TEST_POINTS = [
  { lat: 5.535, lng: -73.367 },
  { lat: 5.5382, lng: -73.3648 },
  { lat: 5.5319, lng: -73.3704 },
  { lat: 5.5421, lng: -73.3599 },
  { lat: 5.5284, lng: -73.3742 },
  { lat: 5.5476, lng: -73.3538 },
  { lat: 5.5248, lng: -73.3811 },
  { lat: 5.5523, lng: -73.3615 },
];

function tunjaLocationForIndex(index, spacing = 0.00018) {
  const point = TUNJA_TEST_POINTS[(index - 1) % TUNJA_TEST_POINTS.length];
  const ring = Math.floor((index - 1) / TUNJA_TEST_POINTS.length);
  const direction = index % 2 === 0 ? 1 : -1;

  return {
    lat: point.lat + ring * spacing * direction,
    lng: point.lng + ring * spacing,
  };
}

module.exports = {
  TUNJA_CENTER,
  TUNJA_TEST_POINTS,
  tunjaLocationForIndex,
};
