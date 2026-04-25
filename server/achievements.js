const ACHIEVEMENTS = [
  { id:'first_blood',   icon:'🩸', name:'First Blood',      desc:'Get your first kill',                       secret:false },
  { id:'hatchling',     icon:'🐣', name:'Hatchling',        desc:'Reach a score of 50',                       secret:false },
  { id:'serpent',       icon:'🐍', name:'Serpent',          desc:'Reach a score of 150',                      secret:false },
  { id:'titan',         icon:'🦕', name:'Titan',            desc:'Reach a score of 300',                      secret:false },
  { id:'speed_demon',   icon:'⚡', name:'Speed Demon',      desc:'Collect 5 speed power-ups',                 secret:false },
  { id:'survivor',      icon:'⏱', name:'Survivor',         desc:'Stay alive for 3 minutes in one game',      secret:false },
  { id:'glutton',       icon:'🍎', name:'Glutton',          desc:'Eat 100 food items total',                  secret:false },
  { id:'predator',      icon:'💀', name:'Predator',         desc:'Get 10 kills total',                        secret:false },
  { id:'apex',          icon:'👑', name:'Apex',             desc:'Get 50 kills total',                        secret:false },
  { id:'pacifist',      icon:'🐢', name:'Pacifist Run',     desc:'Score 80 without boosting',                 secret:false },
  { id:'power_hungry',  icon:'🔋', name:'Power Hungry',     desc:'Collect 50 power-ups total',                secret:false },
  { id:'explorer',      icon:'🗺️',  name:'Explorer',         desc:'Play on all 4 maps',                        secret:false },
  { id:'veteran',       icon:'🎖', name:'Veteran',          desc:'Play 25 games',                             secret:false },
  { id:'centurion',     icon:'💯', name:'Centurion',        desc:'Play 100 games',                            secret:false },
  { id:'ranked_player', icon:'🏅', name:'Ranked Player',    desc:'Play a ranked game',                        secret:false },
  { id:'team_player',   icon:'🤝', name:'Team Player',      desc:'Win a teams game',                          secret:false },
  { id:'ghost_rider',   icon:'👻', name:'Ghost Rider',      desc:'Collect the ghost power-up 5 times',        secret:false },
  { id:'chain_killer',  icon:'🔥', name:'Chain Killer',     desc:'Get 3 kills in a single game',              secret:false },
  { id:'comeback',      icon:'💪', name:'Comeback',         desc:'Score 100 after being below length 30',     secret:true  },
  { id:'season1',       icon:'🎫', name:'Season 1 Veteran', desc:'Reach Battle Pass tier 10',                 secret:false },
  { id:'prestige_one',  icon:'⭐', name:'Prestige I',        desc:'Reach prestige rank 1',                     secret:false },
];

function evaluate(player, stats, patch, mapsPlayed) {
  // Returns array of newly-unlocked achievement ids, given the merged state.
  const merged = { ...stats, ...patch };
  const out = [];
  const test = (cond, id) => { if (cond) out.push(id); };

  test(merged.total_kills >= 1,                 'first_blood');
  test(merged.total_kills >= 10,                'predator');
  test(merged.total_kills >= 50,                'apex');
  test(merged.max_kills_game >= 3,              'chain_killer');
  test(player.score >= 50,                      'hatchling');
  test(player.score >= 150,                     'serpent');
  test(player.score >= 300,                     'titan');
  test(merged.total_food >= 100,                'glutton');
  test(merged.powerups_collected >= 50,         'power_hungry');
  test(merged.ghost_count >= 5,                 'ghost_rider');
  test(merged.games >= 25,                      'veteran');
  test(merged.games >= 100,                     'centurion');
  test(merged.ranked_games >= 1,                'ranked_player');
  test(merged.teams_wins >= 1,                  'team_player');
  test(player._pacifist === true && player.score >= 80, 'pacifist');
  test(merged.total_survive_ticks >= 25 * 180,  'survivor');
  test(Object.keys(mapsPlayed || {}).length >= 4, 'explorer');
  test((merged.prestige || 0) >= 1,             'prestige_one');
  return out;
}

module.exports = { ACHIEVEMENTS, evaluate };
