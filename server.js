const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ── Constants ─────────────────────────────────────────────────────────────────
const TICK                = 1000 / 25;
const SEG_R               = 9;
const MOVE_SPEED          = 2.8;
const BOOST_SPEED         = 5.2;
const TURN_SPEED          = 0.13;
const INIT_SEGS           = 24;
const BOOST_SHRINK_INTERVAL = 8;
const BOT_COUNT           = 6;
const POWERUP_TARGET      = 10;
const PORTAL_PAIRS        = 3;
const ZONE_SHRINK_INTERVAL = 30000;
const ZONE_MIN_RADIUS     = 500;
const ZONE_DAMAGE_TICK    = 4;
const SCORE_WIN           = 200;
const LEVEL_XP            = [0,50,120,220,360,550,800,1100,1500,2000];
const LEVEL_ABILITY       = { 2:'wide_eat', 4:'fast_boost', 6:'long_shield', 8:'ghost' };

// ── Power-ups (6 types) ───────────────────────────────────────────────────────
const POWERUP_TYPES     = ['speed','shield','magnet','freeze','clone','ghost_pu'];
const POWERUP_DURATIONS = {
  speed:5*25, shield:4*25, magnet:8*25,
  freeze:4*25, clone:6*25, ghost_pu:5*25,
};

// ── ELO / Ranked ──────────────────────────────────────────────────────────────
const ELO_K = 32;
const RANK_TIERS = [
  { name:'Bronze',   min:0,    color:'#cd7f32' },
  { name:'Silver',   min:1000, color:'#c0c0c0' },
  { name:'Gold',     min:1200, color:'#ffd700' },
  { name:'Platinum', min:1400, color:'#00e5ff' },
  { name:'Diamond',  min:1600, color:'#b39ddb' },
];
const eloStore = {};
function getElo(id){ return eloStore[id] || (eloStore[id]={ elo:1000, wins:0, losses:0, streak:0 }); }
function calcEloGain(wElo,lElo){ return Math.round(ELO_K*(1-1/(1+Math.pow(10,(lElo-wElo)/400)))); }
function getRank(elo){ for(let i=RANK_TIERS.length-1;i>=0;i--)if(elo>=RANK_TIERS[i].min)return RANK_TIERS[i]; return RANK_TIERS[0]; }

// ── Maps ──────────────────────────────────────────────────────────────────────
const MAPS = {
  classic:{ id:'classic',name:'Classic',W:4000,H:4000,FOOD_TARGET:380,OBSTACLE_COUNT:18,
    palette:['#FF6B6B','#FF9F43','#FFC312','#A3CB38','#1289A7','#C84B31','#EE5A24','#009432','#0652DD','#9980FA','#FDA7DF','#D980FA','#12CBC4','#ED4C67','#F79F1F'],unlockLevel:1 },
  arctic:{ id:'arctic',name:'Arctic',W:3600,H:3600,FOOD_TARGET:320,OBSTACLE_COUNT:24,
    palette:['#cceeff','#99ddff','#66ccff','#33aaee','#ffffff','#aaddff','#77bbff','#55aaee','#88ccff','#bbddff'],unlockLevel:3 },
  volcano:{ id:'volcano',name:'Volcano',W:3200,H:3200,FOOD_TARGET:280,OBSTACLE_COUNT:30,
    palette:['#ff4400','#ff6600','#ff8800','#ffaa00','#ff2200','#cc3300','#ee5500','#ff7700','#dd4400','#ff9900'],unlockLevel:5 },
  space:{ id:'space',name:'Space',W:5000,H:5000,FOOD_TARGET:500,OBSTACLE_COUNT:40,
    palette:['#9980FA','#6c5ce7','#a29bfe','#fd79a8','#e84393','#00cec9','#00b894','#74b9ff','#0984e3','#dfe6e9'],unlockLevel:8 },
};

const TEAM_COLORS = { red:'#FF4757', blue:'#1E90FF' };
const BOT_NAMES   = ['Slinky','Viper','Cobra','Mamba','Rattler','Anaconda','Fangs','Bolt','Slick','Coil','Hydra','Fang'];
const GAME_MODES  = ['classic','score','teams','tournament','ranked'];

const globalScores = [];
function addGlobalScore(name,score){
  globalScores.push({name,score,date:new Date().toLocaleDateString()});
  globalScores.sort((a,b)=>b.score-a.score);
  if(globalScores.length>10)globalScores.length=10;
}

let rooms={}, socketToRoom={}, idCounter=0;
const rnd  = n=>Math.random()*n;
const pick = arr=>arr[Math.floor(Math.random()*arr.length)];
const dist2 = (a,b)=>{const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy;};
const dist  = (a,b)=>Math.sqrt(dist2(a,b));
function angleDiff(a,b){let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;}
function getLevel(xp){for(let i=LEVEL_XP.length-1;i>=0;i--)if(xp>=LEVEL_XP[i])return Math.min(i+1,10);return 1;}
function selfCollisionSkip(p){return Math.min(40,20+Math.floor(p.segs.length/30));}
function wrapDist2(a,b,W,H){let dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y);if(dx>W/2)dx=W-dx;if(dy>H/2)dy=H-dy;return dx*dx+dy*dy;}

// ── Factories ──────────────────────────────────────────────────────────────────
function mkFood(map,x,y,sz,color){return{id:idCounter++,x:x??rnd(map.W),y:y??rnd(map.H),sz:sz??(4+Math.random()*6),color:color??pick(map.palette)};}
function mkPowerup(map){return{id:idCounter++,x:300+rnd(map.W-600),y:300+rnd(map.H-600),type:pick(POWERUP_TYPES),r:14};}
function mkObstacle(map){const r=28+rnd(46);return{id:idCounter++,x:400+rnd(map.W-800),y:400+rnd(map.H-800),r,vx:(Math.random()-.5)*.65,vy:(Math.random()-.5)*.65};}
function mkPortalPair(idx,map){
  return[
    {id:idCounter++,x:300+rnd(map.W-600),y:300+rnd(map.H-600),r:22,pairIdx:idx,which:'a'},
    {id:idCounter++,x:300+rnd(map.W-600),y:300+rnd(map.H-600),r:22,pairIdx:idx,which:'b'},
  ];
}

function mkPlayer(id,name,isBot,skin,team,customSkin,map){
  map=map||MAPS.classic;
  const x=400+rnd(map.W-800),y=400+rnd(map.H-800),angle=Math.random()*Math.PI*2;
  const color=team?TEAM_COLORS[team]:pick(map.palette);
  const segs=[];
  for(let i=0;i<INIT_SEGS;i++)segs.push({x:x-Math.cos(angle)*i*SEG_R*2.5,y:y-Math.sin(angle)*i*SEG_R*2.5});
  return{id,name:isBot?name:(name||'Anonymous').slice(0,16),color,skin:skin||'solid',segs,angle,targetAngle:angle,team:team||null,
    customSkin:customSkin||null,boosting:false,boostTick:0,score:INIT_SEGS,alive:true,killCount:0,isBot:!!isBot,
    powerup:null,powerupTick:0,powerupDuration:0,zoneDamageTick:0,_zoneDeath:false,
    botWanderTick:0,botState:'forage',botDodgeTick:0,
    xp:0,level:1,abilities:[],emote:null,emoteTick:0,portalCooldown:0,
    cloneId:null,frozen:0,_respawnTick:0,
  };
}

function mkRoom(id,name,mode,mapId){
  const map=MAPS[mapId]||MAPS.classic;
  const food=Array.from({length:map.FOOD_TARGET},()=>mkFood(map));
  const powerups=Array.from({length:POWERUP_TARGET},()=>mkPowerup(map));
  const obstacles=Array.from({length:map.OBSTACLE_COUNT},()=>mkObstacle(map));
  const portals=[];for(let i=0;i<PORTAL_PAIRS;i++)portals.push(...mkPortalPair(i,map));
  const bots={};
  const shuffled=[...BOT_NAMES].sort(()=>Math.random()-.5);
  for(let i=0;i<BOT_COUNT;i++){
    const bid='bot_'+idCounter++;
    const team=mode==='teams'?(i%2===0?'red':'blue'):null;
    bots[bid]=mkPlayer(bid,shuffled[i]+'_AI',true,'solid',team,null,map);
  }
  return{id,name:name||'Room '+id.slice(-4),mode:mode||'classic',map,
    W:map.W,H:map.H,FOOD_TARGET:map.FOOD_TARGET,
    players:{},bots,food,powerups,obstacles,portals,clones:{},
    killFeed:[],chatMsgs:[],mapPings:[],
    zone:{x:map.W/2,y:map.H/2,r:Math.hypot(map.W,map.H)/2+200,targetR:Math.hypot(map.W,map.H)/2+200},
    tickCount:0,intervalId:null,zoneTimer:null,
    winner:null,teamScores:{red:0,blue:0},tournamentBracket:null,
    activeEvent:null,eventCooldown:0,
  };
}

// ── Obstacles ─────────────────────────────────────────────────────────────────
function tickObstacles(room){
  for(const ob of room.obstacles){
    ob.x=((ob.x+ob.vx)%room.W+room.W)%room.W;
    ob.y=((ob.y+ob.vy)%room.H+room.H)%room.H;
    if(ob.x<200||ob.x>room.W-200)ob.vx*=-1;
    if(ob.y<200||ob.y>room.H-200)ob.vy*=-1;
  }
}

// ── Portal ────────────────────────────────────────────────────────────────────
function tryPortal(p,room){
  if(p.portalCooldown>0){p.portalCooldown--;return;}
  const head=p.segs[0];
  for(const portal of room.portals){
    if(wrapDist2(head,portal,room.W,room.H)<(SEG_R+portal.r)**2){
      const partner=room.portals.find(q=>q.pairIdx===portal.pairIdx&&q.which!==portal.which);
      if(!partner)continue;
      const dx=((partner.x+head.x-portal.x)%room.W+room.W)%room.W-head.x;
      const dy=((partner.y+head.y-portal.y)%room.H+room.H)%room.H-head.y;
      for(const seg of p.segs){seg.x=((seg.x+dx)%room.W+room.W)%room.W;seg.y=((seg.y+dy)%room.H+room.H)%room.H;}
      p.portalCooldown=60;
      if(!p.isBot)io.to(p.id).emit('sfx','portal');
      return;
    }
  }
}

// ── IMPROVED BOT AI ───────────────────────────────────────────────────────────
function updateBot(bot,room){
  if(!bot.alive){
    bot._respawnTick++;
    if(bot._respawnTick>150)Object.assign(bot,mkPlayer(bot.id,bot.name,true,'solid',room.mode==='teams'?bot.team:null,null,room.map));
    return;
  }
  if(bot.frozen>0){bot.frozen--;return;}

  const head=bot.segs[0];
  const {W,H}=room;
  bot.botWanderTick++;

  // Zone avoidance — highest priority
  if(dist(head,room.zone)>room.zone.r-350){
    bot.targetAngle=Math.atan2(room.zone.y-head.y,room.zone.x-head.x);
    bot.botState='zone';return;
  }

  const all=Object.values({...room.players,...room.bots}).filter(p=>p.alive&&p.id!==bot.id&&!p.isClone);

  // Dodge nearby snake heads
  if(bot.botDodgeTick>0){bot.botDodgeTick--;return;}
  for(const other of all){
    if(wrapDist2(head,other.segs[0],W,H)<180*180){
      const approachAng=Math.atan2(head.y-other.segs[0].y,head.x-other.segs[0].x);
      if(Math.abs(angleDiff(other.angle,approachAng))<0.85){
        bot.targetAngle=bot.angle+(Math.random()<.5?1.2:-1.2);
        bot.botDodgeTick=18;return;
      }
    }
  }

  // Hunt smaller snakes when large
  if(bot.segs.length>60&&bot.botWanderTick%25===0){
    for(const other of all){
      if(!other.isBot&&other.segs.length<bot.segs.length*0.7){
        const d=wrapDist2(head,other.segs[0],W,H);
        if(d<480*480){
          bot.targetAngle=Math.atan2(other.segs[0].y-head.y,other.segs[0].x-head.x);
          bot.botState='hunt';bot.boosting=d<250*250;return;
        }
      }
    }
  }

  // Seek power-ups
  if(bot.botWanderTick%18===0&&!bot.powerup){
    for(const pu of room.powerups){
      const d=wrapDist2(head,pu,W,H);
      if(d<280*280){bot.targetAngle=Math.atan2(pu.y-head.y,pu.x-head.x);bot.botState='powerup';return;}
    }
  }

  // Forage
  if(bot.botWanderTick>18+Math.floor(rnd(28))){
    const sample=room.food.length>80?room.food.filter((_,i)=>i%3===0):room.food;
    let best=null,bestD=Infinity;
    for(const f of sample){const d=wrapDist2(head,f,W,H);if(d<bestD){bestD=d;best=f;}}
    if(best)bot.targetAngle=Math.atan2(best.y-head.y,best.x-head.x)+(Math.random()-.5)*.3;
    bot.botWanderTick=0;bot.botState='forage';
  }
  bot.boosting=(bot.botState==='hunt')||(bot.segs.length>80&&Math.random()<.05);
}

// ── CLONE DECOY ───────────────────────────────────────────────────────────────
function spawnClone(p,room){
  if(p.cloneId)return;
  const cid='clone_'+idCounter++;
  room.clones[cid]={
    id:cid,name:p.name,color:p.color,skin:p.skin,customSkin:p.customSkin,
    segs:p.segs.map(s=>({...s})),alive:true,isClone:true,ownerId:p.id,cloneTick:0,
    angle:p.angle+0.3,team:p.team,level:p.level,score:0,
    boosting:false,powerup:null,powerupTick:0,powerupDuration:1,
    isBot:false,xp:0,abilities:[],emote:null,
  };
  p.cloneId=cid;
}

function tickClones(room){
  for(const[cid,clone]of Object.entries(room.clones)){
    clone.cloneTick++;
    if(Math.random()<.04)clone.angle+=(Math.random()-.5)*.4;
    const spd=MOVE_SPEED*.85;
    const head=clone.segs[0];
    const nx=((head.x+Math.cos(clone.angle)*spd)%room.W+room.W)%room.W;
    const ny=((head.y+Math.sin(clone.angle)*spd)%room.H+room.H)%room.H;
    clone.segs.unshift({x:nx,y:ny});clone.segs.pop();
    if(clone.cloneTick>POWERUP_DURATIONS.clone){
      const owner=room.players[clone.ownerId]||room.bots[clone.ownerId];
      if(owner)owner.cloneId=null;
      delete room.clones[cid];
    }
  }
}

// ── MAP EVENTS ────────────────────────────────────────────────────────────────
const EVENT_INTERVAL = 3000; // ~2 min at 25tps
const EVENT_DURATION = {meteor:200,blizzard:350,eruption:220,surge:120};
const MAP_EVENTS     = {space:['meteor'],arctic:['blizzard'],volcano:['eruption'],classic:['surge']};

function startMapEvent(room){
  const type=pick(MAP_EVENTS[room.map.id]||['surge']);
  const {W,H}=room;
  let data={};

  if(type==='meteor'){
    data={x:rnd(W),y:rnd(H),vx:(Math.random()-.5)*3.5,vy:(Math.random()-.5)*3.5,r:160};
  } else if(type==='blizzard'){
    data={speedMult:0.55};
  } else if(type==='eruption'){
    data={lavaRocks:[]};
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2,r=380+rnd(280);
      const ob={id:idCounter++,x:W/2+Math.cos(a)*r,y:H/2+Math.sin(a)*r,r:48,vx:Math.cos(a)*.9,vy:Math.sin(a)*.9};
      data.lavaRocks.push(ob);
    }
    room.obstacles.push(...data.lavaRocks);
  } else if(type==='surge'){
    for(const p of Object.values({...room.players,...room.bots}))
      if(p.alive&&!p.powerup){p.powerup='speed';p.powerupTick=0;p.powerupDuration=90;}
  }

  room.activeEvent={type,tick:0,duration:EVENT_DURATION[type]||200,data};
  io.to(room.id).emit('mapEvent',{type,duration:room.activeEvent.duration,
    data:{r:data.r,speedMult:data.speedMult,x:data.x,y:data.y}});
  console.log(`🌍 [${type}] in room ${room.id}`);
}

function tickMapEvent(room){
  room.eventCooldown=(room.eventCooldown||0)+1;
  const ev=room.activeEvent;
  if(!ev){
    if(room.eventCooldown>=EVENT_INTERVAL){
      room.eventCooldown=0;
      const anyAlive=Object.values({...room.players,...room.bots}).some(p=>p.alive);
      if(anyAlive)startMapEvent(room);
    }
    return;
  }
  ev.tick++;
  if(ev.type==='meteor'){
    const {W,H}=room;
    ev.data.x=((ev.data.x+ev.data.vx)%W+W)%W;
    ev.data.y=((ev.data.y+ev.data.vy)%H+H)%H;
    if(ev.tick%5===0)io.to(room.id).emit('eventUpdate',{type:'meteor',x:ev.data.x,y:ev.data.y,r:ev.data.r});
    // Chip health inside meteor zone
    for(const p of Object.values({...room.players,...room.bots})){
      if(!p.alive||p.powerup==='shield'||p.powerup==='ghost_pu')continue;
      if(wrapDist2(p.segs[0],ev.data,W,H)<ev.data.r*ev.data.r&&p.segs.length>8){
        if(ev.tick%8===0){const d=p.segs.pop();room.food.push(mkFood(room.map,d.x,d.y,5,p.color));p.score=Math.max(1,p.score-1);}
      }
    }
  }
  if(ev.tick>=ev.duration){
    if(ev.type==='eruption'&&ev.data.lavaRocks){
      const ids=new Set(ev.data.lavaRocks.map(r=>r.id));
      room.obstacles=room.obstacles.filter(ob=>!ids.has(ob.id));
    }
    room.activeEvent=null;room.eventCooldown=0;
    io.to(room.id).emit('mapEvent',{type:'end'});
  }
}

// ── Zone / kill helpers ───────────────────────────────────────────────────────
function startZone(room){
  let n=0;room.zoneTimer=setInterval(()=>{
    n++;const newR=Math.max(ZONE_MIN_RADIUS,room.zone.r*(n<4?.78:.65));
    room.zone.targetR=newR;if(newR<=ZONE_MIN_RADIUS)clearInterval(room.zoneTimer);
  },ZONE_SHRINK_INTERVAL);
}

function addKill(room,killer,victim,kcolor,pos){
  room.killFeed.unshift({killer,victim,color:kcolor,t:Date.now()});
  if(room.killFeed.length>6)room.killFeed.length=6;
  if(pos){room.mapPings.push({x:pos.x,y:pos.y,t:Date.now(),color:kcolor});if(room.mapPings.length>10)room.mapPings.length=10;}
}

function checkWin(room,all){
  if(room.winner)return;
  if(room.mode==='score'){
    for(const p of Object.values(all))if(p.alive&&p.score>=SCORE_WIN){
      room.winner={name:p.name,score:p.score};if(!p.isBot)addGlobalScore(p.name,p.score);io.to(room.id).emit('gameOver',room.winner);
    }
  }
  if(room.mode==='teams'){
    room.teamScores={red:0,blue:0};
    for(const p of Object.values(all))if(p.team)room.teamScores[p.team]=(room.teamScores[p.team]||0)+p.score;
    if(room.teamScores.red>=SCORE_WIN*3||room.teamScores.blue>=SCORE_WIN*3){
      const w=room.teamScores.red>room.teamScores.blue?'red':'blue';
      room.winner={team:w,score:room.teamScores[w]};io.to(room.id).emit('gameOver',room.winner);
    }
  }
  if(room.mode==='ranked'){
    const humans=Object.values(room.players).filter(p=>p.alive);
    if(humans.length<=1&&Object.keys(room.players).length>1){
      const winner=humans[0];
      if(winner){
        Object.keys(room.players).forEach(id=>{
          if(id===winner.id)return;
          const w=getElo(winner.id),l=getElo(id);
          const gain=calcEloGain(w.elo,l.elo);
          w.elo+=gain;w.wins++;w.streak++;
          l.elo=Math.max(0,l.elo-gain);l.losses++;l.streak=0;
          io.to(id).emit('eloResult',{change:-gain,newElo:l.elo,rank:getRank(l.elo)});
        });
        const wd=getElo(winner.id);
        io.to(winner.id).emit('eloResult',{change:calcEloGain(wd.elo,1000),newElo:wd.elo,rank:getRank(wd.elo)});
      }
      room.winner={name:winner?.name||'?',score:winner?.score||0};
      io.to(room.id).emit('gameOver',room.winner);
    }
  }
}

function startTournament(room){
  const humans=Object.keys(room.players);if(humans.length<2)return;
  const p=[...humans];while(p.length<4)p.push(null);
  room.tournamentBracket={rounds:[[[p[0],p[1]],[p[2],p[3]]]],currentRound:0,currentMatch:0,winners:[]};
  io.to(room.id).emit('tournamentStart',room.tournamentBracket);
}

// ── Main tick ─────────────────────────────────────────────────────────────────
function tickRoom(room){
  if(room.winner)return;
  room.tickCount++;
  const{W,H,FOOD_TARGET,map}=room;
  const all={...room.players,...room.bots};
  const alive=Object.values(all).filter(p=>p.alive);

  if(room.zone.r>room.zone.targetR)room.zone.r=Math.max(room.zone.targetR,room.zone.r-.6);
  tickObstacles(room);
  tickClones(room);
  tickMapEvent(room);
  for(const bot of Object.values(room.bots))updateBot(bot,room);

  const blizzard=room.activeEvent?.type==='blizzard';

  for(const p of alive){
    if(p.frozen>0){p.frozen--;continue;}
    const diff=angleDiff(p.angle,p.targetAngle);
    p.angle+=Math.max(-TURN_SPEED,Math.min(TURN_SPEED,diff));
    let spd=p.boosting?BOOST_SPEED:MOVE_SPEED;
    if(p.powerup==='speed')spd*=1.9;
    if(p.abilities.includes('fast_boost')&&p.boosting)spd*=1.2;
    if(blizzard&&p.powerup!=='ghost_pu')spd*=0.58;
    if(p.powerup==='ghost_pu')spd*=1.12;
    const head=p.segs[0];
    const nx=((head.x+Math.cos(p.angle)*spd)%W+W)%W;
    const ny=((head.y+Math.sin(p.angle)*spd)%H+H)%H;
    p.segs.unshift({x:nx,y:ny});
    if(p.boosting&&p.segs.length>INIT_SEGS+2){
      p.boostTick++;
      if(p.boostTick>=BOOST_SHRINK_INTERVAL){p.boostTick=0;const d=p.segs.pop();room.food.push(mkFood(map,d.x,d.y,6,p.color));p.score=Math.max(INIT_SEGS,p.score-1);}
      else p.segs.pop();
    }else p.segs.pop();
    if(p.powerup==='magnet'){const mr2=220*220;for(const f of room.food)if(dist2({x:nx,y:ny},f)<mr2){f.x+=(nx-f.x)*.07;f.y+=(ny-f.y)*.07;}}
    const eatR2=((SEG_R+9)*(p.abilities.includes('wide_eat')?1.7:1))**2;
    for(let i=room.food.length-1;i>=0;i--){
      if(wrapDist2({x:nx,y:ny},room.food[i],W,H)<eatR2){
        const f=room.food.splice(i,1)[0];const grow=Math.ceil(f.sz/3);
        for(let g=0;g<grow;g++)p.segs.push({...p.segs[p.segs.length-1]});
        p.score+=grow;p.xp+=grow;
        const nl=getLevel(p.xp);
        if(nl>p.level){p.level=nl;const ab=LEVEL_ABILITY[nl];if(ab&&!p.abilities.includes(ab))p.abilities.push(ab);if(!p.isBot){io.to(p.id).emit('levelUp',{level:nl,ability:ab||null});io.to(p.id).emit('sfx','levelup');}}
        if(!p.isBot)io.to(p.id).emit('sfx','eat');
      }
    }
    for(let i=room.powerups.length-1;i>=0;i--){
      const pu=room.powerups[i];
      if(wrapDist2({x:nx,y:ny},pu,W,H)<(SEG_R+pu.r)**2){
        room.powerups.splice(i,1);
        p.powerup=pu.type;p.powerupTick=0;
        let dur=POWERUP_DURATIONS[pu.type]||150;
        if(pu.type==='shield'&&p.abilities.includes('long_shield'))dur*=2;
        p.powerupDuration=dur;
        if(pu.type==='freeze'){
          const fr2=300*300;
          for(const other of Object.values({...room.players,...room.bots})){
            if(other.id!==p.id&&other.alive&&wrapDist2(head,other.segs[0],W,H)<fr2){
              other.frozen=Math.floor(dur*0.7);
              if(!other.isBot)io.to(other.id).emit('sfx','freeze');
            }
          }
        }
        if(pu.type==='clone')spawnClone(p,room);
        if(!p.isBot){io.to(p.id).emit('sfx','powerup');io.to(p.id).emit('powerup',pu.type);}
      }
    }
    if(p.powerup){p.powerupTick++;if(p.powerupTick>=p.powerupDuration){p.powerup=null;if(p.cloneId){delete room.clones[p.cloneId];p.cloneId=null;}}}
    tryPortal(p,room);
    if(p.powerup!=='ghost_pu'&&dist({x:nx,y:ny},room.zone)>room.zone.r&&p.powerup!=='shield'){
      p.zoneDamageTick++;
      if(p.zoneDamageTick>=ZONE_DAMAGE_TICK){p.zoneDamageTick=0;if(p.segs.length>8){const d=p.segs.pop();room.food.push(mkFood(map,d.x,d.y,5,p.color));p.score=Math.max(1,p.score-1);}else p._zoneDeath=true;}
    }else p.zoneDamageTick=0;
    if(p.emote){p.emoteTick++;if(p.emoteTick>75){p.emote=null;p.emoteTick=0;}}
  }

  // ── Collision ────────────────────────────────────────────────────────────────
  const dead=new Set();
  for(const p of alive){
    if(dead.has(p.id)||p._zoneDeath)continue;
    if(p.powerup==='shield'||p.powerup==='ghost_pu'||p.abilities.includes('ghost'))continue;
    const head=p.segs[0];
    for(const ob of room.obstacles){if(wrapDist2(head,ob,W,H)<(SEG_R+ob.r*0.80)**2){dead.add(p.id);break;}}
    if(dead.has(p.id))continue;
    for(const other of alive){
      const isSelf=other.id===p.id;
      if(!isSelf&&room.mode==='teams'&&p.team&&other.team&&p.team===other.team)continue;
      if(other.isClone)continue;
      const skip=isSelf?selfCollisionSkip(p):0;
      const colR2=isSelf?(SEG_R*1.3)**2:(SEG_R*1.9)**2;
      const checkTo=dead.has(other.id)?Math.min(1,other.segs.length):other.segs.length;
      for(let i=skip;i<checkTo;i++){
        if(wrapDist2(head,other.segs[i],W,H)<colR2){
          dead.add(p.id);
          if(!isSelf&&!dead.has(other.id)){other.killCount++;other.xp+=30;addKill(room,other.name,p.name,other.color,head);if(!other.isBot)io.to(other.id).emit('sfx','kill');}
          break;
        }
      }
      if(dead.has(p.id))break;
    }
  }
  for(const p of alive)if(p._zoneDeath){dead.add(p.id);p._zoneDeath=false;}
  for(const id of dead){
    const p=all[id];if(!p)continue;p.alive=false;
    if(p.cloneId){delete room.clones[p.cloneId];p.cloneId=null;}
    for(let i=0;i<p.segs.length;i+=2)room.food.push(mkFood(map,p.segs[i].x,p.segs[i].y,7+Math.random()*5,p.color));
    if(!p.isBot){addGlobalScore(p.name,p.score);io.to(id).emit('died',{score:p.score,kills:p.killCount,level:p.level,xp:p.xp});}
  }

  checkWin(room,all);
  while(room.food.length<FOOD_TARGET)room.food.push(mkFood(map));
  if(room.food.length>FOOD_TARGET*1.5)room.food.length=FOOD_TARGET;
  while(room.powerups.length<POWERUP_TARGET)room.powerups.push(mkPowerup(map));

  const now=Date.now();
  room.killFeed=room.killFeed.filter(k=>now-k.t<5000);
  room.mapPings=room.mapPings.filter(k=>now-k.t<3000);
  room.chatMsgs=room.chatMsgs.filter(k=>now-k.t<8000);

  const leaderboard=Object.values(all).sort((a,b)=>b.score-a.score).slice(0,10)
    .map(p=>({name:p.name,score:p.score,alive:p.alive,kills:p.killCount,isBot:p.isBot,color:p.color,team:p.team,level:p.level}));

  const cloneArr=Object.values(room.clones).map(c=>({
    id:c.id,name:c.name,color:c.color,skin:c.skin,customSkin:c.customSkin,
    segs:c.segs,score:0,boosting:false,powerup:null,powerupTick:0,powerupDuration:1,
    isBot:true,isClone:true,team:c.team,level:1,xp:0,abilities:[],emote:null,frozen:false,
  }));

  const pArr=Object.values(all).filter(p=>p.alive).map(p=>({
    id:p.id,name:p.name,color:p.color,skin:p.skin,customSkin:p.customSkin,segs:p.segs,
    score:p.score,boosting:p.boosting,powerup:p.powerup,powerupTick:p.powerupTick,
    powerupDuration:p.powerupDuration||1,isBot:p.isBot,team:p.team,level:p.level,
    xp:p.xp,abilities:p.abilities,emote:p.emote,frozen:p.frozen>0,
  }));

  const evOut=room.activeEvent?{
    type:room.activeEvent.type,tick:room.activeEvent.tick,duration:room.activeEvent.duration,
    data:{x:room.activeEvent.data.x,y:room.activeEvent.data.y,r:room.activeEvent.data.r,speedMult:room.activeEvent.data.speedMult},
  }:null;

  io.to(room.id).emit('state',{
    players:[...pArr,...cloneArr],food:room.food,powerups:room.powerups,
    obstacles:room.obstacles,portals:room.portals,leaderboard,
    killFeed:room.killFeed,zone:room.zone,mode:room.mode,
    teamScores:room.teamScores,scoreWin:SCORE_WIN,chatMsgs:room.chatMsgs,
    mapPings:room.mapPings,mapId:room.map.id,W,H,activeEvent:evOut,
  });
}

// ── Socket ────────────────────────────────────────────────────────────────────
io.on('connection',socket=>{
  socket.on('getRooms',()=>{
    socket.emit('roomList',Object.values(rooms).map(r=>({id:r.id,name:r.name,players:Object.keys(r.players).length,mode:r.mode,mapId:r.map.id})));
    socket.emit('globalScores',globalScores.slice(0,10));
    socket.emit('mapList',Object.values(MAPS).map(m=>({id:m.id,name:m.name,unlockLevel:m.unlockLevel})));
    const ed=eloStore[socket.id];
    if(ed)socket.emit('eloData',{...ed,rank:getRank(ed.elo)});
  });
  socket.on('createRoom',({name,roomName,skin,mode,mapId,customSkin})=>{
    const roomId='r'+idCounter++;const m=GAME_MODES.includes(mode)?mode:'classic';
    const room=mkRoom(roomId,roomName,m,mapId||'classic');rooms[roomId]=room;
    room.intervalId=setInterval(()=>tickRoom(room),TICK);
    if(['classic','score','ranked'].includes(m))startZone(room);
    joinRoom(socket,room,name,skin,m,customSkin);
  });
  socket.on('joinRoom',({roomId,name,skin,customSkin})=>{
    const room=rooms[roomId];if(!room)return socket.emit('error','Room not found');
    joinRoom(socket,room,name,skin,room.mode,customSkin);
  });
  socket.on('input',({angle,boosting})=>{
    const r=rooms[socketToRoom[socket.id]];const p=r?.players[socket.id];
    if(!p||!p.alive||p.frozen>0)return;
    p.targetAngle=angle;p.boosting=boosting;
  });
  socket.on('emote',emoji=>{const r=rooms[socketToRoom[socket.id]];const p=r?.players[socket.id];if(!p||!p.alive)return;if(!['😂','😎','👋','💀'].includes(emoji))return;p.emote=emoji;p.emoteTick=0;});
  socket.on('chat',msg=>{const r=rooms[socketToRoom[socket.id]];if(!r)return;const p=r.players[socket.id];const clean=(msg||'').slice(0,60).replace(/[<>]/g,'');if(!clean)return;r.chatMsgs.push({name:p?.name||'?',msg:clean,color:p?.color||'#fff',t:Date.now()});if(r.chatMsgs.length>20)r.chatMsgs.shift();});
  socket.on('startTournament',()=>{const r=rooms[socketToRoom[socket.id]];if(!r||r.mode!=='tournament')return;startTournament(r);});
  socket.on('respawn',({name,skin,customSkin})=>{
    const r=rooms[socketToRoom[socket.id]];if(!r||r.winner)return;
    const team=r.mode==='teams'?(Object.values(r.players).filter(p=>p.team==='red').length<=Object.values(r.players).filter(p=>p.team==='blue').length?'red':'blue'):null;
    r.players[socket.id]=mkPlayer(socket.id,name,false,skin||'solid',team,customSkin||null,r.map);
  });
  socket.on('disconnect',()=>{
    const roomId=socketToRoom[socket.id];
    if(roomId&&rooms[roomId]){delete rooms[roomId].players[socket.id];setTimeout(()=>{const r=rooms[roomId];if(r&&Object.keys(r.players).length===0){clearInterval(r.intervalId);clearInterval(r.zoneTimer);delete rooms[roomId];}},60000);}
    delete socketToRoom[socket.id];
  });
});

function joinRoom(socket,room,name,skin,mode,customSkin){
  const team=mode==='teams'?(Object.values(room.players).filter(p=>p.team==='red').length<=Object.values(room.players).filter(p=>p.team==='blue').length?'red':'blue'):null;
  socket.join(room.id);socketToRoom[socket.id]=room.id;
  room.players[socket.id]=mkPlayer(socket.id,name,false,skin||'solid',team,customSkin||null,room.map);
  const ed=getElo(socket.id);
  socket.emit('joined',{id:socket.id,W:room.W,H:room.H,roomId:room.id,roomName:room.name,mode:room.mode,team,mapId:room.map.id,elo:ed.elo,rank:getRank(ed.elo)});
}

// ── Stripe ────────────────────────────────────────────────────────────────────
const crypto=require('crypto');
const STRIPE_SECRET  = process.env.STRIPE_SECRET_KEY||'';
const STRIPE_WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET||'';
const TOKEN_SECRET   = process.env.TOKEN_SECRET||'change-me-in-production';
const PRICE_ID       = process.env.STRIPE_PRICE_ID||'';
const PUBLIC_URL     = process.env.PUBLIC_URL||'http://localhost:3000';
let stripe=null;
if(STRIPE_SECRET){try{stripe=require('stripe')(STRIPE_SECRET);}catch(e){console.warn('Stripe not available:',e.message);}}
app.use('/api/stripe-webhook',express.raw({type:'application/json'}));
app.use(express.json());
app.post('/api/create-checkout',async(req,res)=>{
  if(!stripe||!PRICE_ID)return res.status(503).json({error:'Stripe not configured'});
  try{const session=await stripe.checkout.sessions.create({mode:'payment',line_items:[{price:PRICE_ID,quantity:1}],success_url:`${PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${PUBLIC_URL}/`,metadata:{product:'supporter_pack'}});res.json({url:session.url});}
  catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/verify-purchase',async(req,res)=>{
  const{session_id}=req.query;if(!stripe||!session_id)return res.status(400).json({error:'Missing params'});
  try{const session=await stripe.checkout.sessions.retrieve(session_id);if(session.payment_status!=='paid')return res.status(402).json({error:'Not paid'});const payload=`supporter:${session.id}`;const sig=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('hex');res.json({token:`${payload}:${sig}`,product:session.metadata.product});}
  catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/verify-token',(req,res)=>{
  const{token}=req.query;if(!token)return res.status(400).json({valid:false});
  const parts=token.split(':');if(parts.length!==3)return res.status(400).json({valid:false});
  const[type,sessionId,clientSig]=parts;const payload=`${type}:${sessionId}`;
  const expectedSig=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('hex');
  const valid=crypto.timingSafeEqual(Buffer.from(clientSig,'hex'),Buffer.from(expectedSig,'hex'));
  res.json({valid,product:valid?'supporter_pack':null});
});
app.post('/api/stripe-webhook',(req,res)=>{
  if(!stripe||!STRIPE_WEBHOOK)return res.sendStatus(200);
  let event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],STRIPE_WEBHOOK);}catch(e){return res.status(400).send(`Webhook error: ${e.message}`);}
  if(event.type==='checkout.session.completed')console.log('✅ Purchase confirmed:',event.data.object.id);
  res.sendStatus(200);
});
app.use(express.static(path.join(__dirname,'public')));
server.listen(process.env.PORT||3000,()=>console.log('🐍 NeonSlither v6 → http://localhost:'+(process.env.PORT||3000)));
