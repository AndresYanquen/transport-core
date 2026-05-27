const { generateRoutePoints, jitter } = require("./coordinates");

function buildMovementPlan({ start, end, steps = 20 }) {
  const points = generateRoutePoints(start, end, steps);
  let index = 0;

  return {
    next() {
      if (index >= points.length) {
        return { done: true, location: end };
      }
      const location = points[index];
      index += 1;
      return { done: false, location };
    },
  };
}

function moveWithNoise(location) {
  return jitter(location, 10);
}

module.exports = {
  buildMovementPlan,
  moveWithNoise,
};

