'use strict';
const { MAPS: SHARED_MAPS } = require('../../shared/constants');

const PALETTES = {
  classic: ['#FF6B6B', '#FF9F43', '#FFC312', '#A3CB38', '#1289A7', '#C84B31', '#EE5A24', '#009432', '#0652DD', '#9980FA', '#FDA7DF', '#D980FA', '#12CBC4', '#ED4C67', '#F79F1F'],
  arctic: ['#cceeff', '#99ddff', '#66ccff', '#33aaee', '#ffffff', '#aaddff', '#77bbff', '#55aaee', '#88ccff', '#bbddff'],
  volcano: ['#ff4400', '#ff6600', '#ff8800', '#ffaa00', '#ff2200', '#cc3300', '#ee5500', '#ff7700', '#dd4400', '#ff9900'],
  space: ['#9980FA', '#6c5ce7', '#a29bfe', '#fd79a8', '#e84393', '#00cec9', '#00b894', '#74b9ff', '#0984e3', '#dfe6e9'],
};
const EXTRA = {
  classic: { FOOD_TARGET: 380, OBSTACLE_COUNT: 18, events: ['surge'] },
  arctic: { FOOD_TARGET: 320, OBSTACLE_COUNT: 24, events: ['blizzard'] },
  volcano: { FOOD_TARGET: 280, OBSTACLE_COUNT: 30, events: ['eruption'] },
  space: { FOOD_TARGET: 500, OBSTACLE_COUNT: 40, events: ['meteor'] },
};

const MAPS = {};
for (const id of Object.keys(SHARED_MAPS)) {
  MAPS[id] = { ...SHARED_MAPS[id], ...EXTRA[id], palette: PALETTES[id] };
}

// Arena maps are sized to the number of players so density stays similar.
function arenaMap(baseId, players) {
  const base = MAPS[baseId] || MAPS.classic;
  const size = Math.round(1800 + 160 * Math.max(2, players));
  return { ...base, W: size, H: size, FOOD_TARGET: Math.round(size * size * 2.4e-5), OBSTACLE_COUNT: 0 };
}

module.exports = { MAPS, arenaMap };
