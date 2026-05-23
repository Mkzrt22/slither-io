// Pure-data module: world maps, team palette, bot name pool, accepted game
// modes. Kept apart from server.js so unit tests can import without booting
// the network stack.

const MAPS = {
  classic: {
    id: 'classic', name: 'Classic', W: 4000, H: 4000,
    FOOD_TARGET: 380, OBSTACLE_COUNT: 18,
    palette: ['#FF6B6B','#FF9F43','#FFC312','#A3CB38','#1289A7','#C84B31','#EE5A24','#009432','#0652DD','#9980FA','#FDA7DF','#D980FA','#12CBC4','#ED4C67','#F79F1F'],
    unlockLevel: 1,
  },
  arctic: {
    id: 'arctic', name: 'Arctic', W: 3600, H: 3600,
    FOOD_TARGET: 320, OBSTACLE_COUNT: 24,
    palette: ['#cceeff','#99ddff','#66ccff','#33aaee','#ffffff','#aaddff','#77bbff','#55aaee','#88ccff','#bbddff'],
    unlockLevel: 3,
  },
  volcano: {
    id: 'volcano', name: 'Volcano', W: 3200, H: 3200,
    FOOD_TARGET: 280, OBSTACLE_COUNT: 30,
    palette: ['#ff4400','#ff6600','#ff8800','#ffaa00','#ff2200','#cc3300','#ee5500','#ff7700','#dd4400','#ff9900'],
    unlockLevel: 5,
  },
  space: {
    id: 'space', name: 'Space', W: 5000, H: 5000,
    FOOD_TARGET: 500, OBSTACLE_COUNT: 40,
    palette: ['#9980FA','#6c5ce7','#a29bfe','#fd79a8','#e84393','#00cec9','#00b894','#74b9ff','#0984e3','#dfe6e9'],
    unlockLevel: 8,
  },
};

const TEAM_COLORS = { red: '#FF4757', blue: '#1E90FF' };

const BOT_NAMES = [
  'Slinky', 'Viper', 'Cobra', 'Mamba', 'Rattler', 'Anaconda',
  'Fangs', 'Bolt', 'Slick', 'Coil', 'Hydra', 'Fang',
];

const GAME_MODES = ['classic', 'score', 'teams', 'tournament', 'ranked'];

const MAP_EVENTS = {
  space:   ['meteor'],
  arctic:  ['blizzard'],
  volcano: ['eruption'],
  classic: ['surge'],
};

const EVENT_INTERVAL = 3000;  // ticks between possible events (~2 min @ 25 Hz)
const EVENT_DURATION = { meteor: 200, blizzard: 350, eruption: 220, surge: 120 };

module.exports = { MAPS, TEAM_COLORS, BOT_NAMES, GAME_MODES, MAP_EVENTS, EVENT_INTERVAL, EVENT_DURATION };
