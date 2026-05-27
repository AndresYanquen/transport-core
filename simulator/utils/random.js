function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, maxInclusive) {
  return Math.floor(randFloat(min, maxInclusive + 1));
}

function chance(probability) {
  return Math.random() < probability;
}

function pickOne(items) {
  return items[Math.floor(Math.random() * items.length)];
}

module.exports = {
  randFloat,
  randInt,
  chance,
  pickOne,
};

