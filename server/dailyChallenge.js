const DAILY_CHALLENGES = [
  { id:'score',      icon:'🏆', label:'High Scorer',     desc:'Reach a score of 150 in one life',  goal:150,  unit:'pts'  },
  { id:'kills',      icon:'💀', label:'Predator',        desc:'Get 5 kills in one game',           goal:5,    unit:'kills'},
  { id:'no_boost',   icon:'🐢', label:'Pacifist Run',    desc:'Score 80 without ever boosting',    goal:80,   unit:'pts'  },
  { id:'powerups',   icon:'⚡', label:'Power Collector', desc:'Collect 8 power-ups in one game',   goal:8,    unit:'PUs'  },
  { id:'survive',    icon:'⏱', label:'Survivor',        desc:'Stay alive for 90 seconds',         goal:90,   unit:'sec'  },
  { id:'eat_streak', icon:'🍎', label:'Glutton',         desc:'Eat 40 food items without dying',   goal:40,   unit:'food' },
  { id:'length',     icon:'📏', label:'Mega Snake',      desc:'Reach a length of 70 segments',     goal:70,   unit:'segs' },
  { id:'multi_kill', icon:'🔥', label:'Double Kill',     desc:'Get 2 kills within 8 seconds',      goal:2,    unit:'kills'},
];

function getDailyChallenge(date) {
  const d = date || new Date();
  const dayNum = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  const ch = DAILY_CHALLENGES[dayNum % DAILY_CHALLENGES.length];
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  return { ...ch, date: dateStr };
}

module.exports = { DAILY_CHALLENGES, getDailyChallenge };
