'use strict';
const U = require('../util');

// Steers one bot for the current tick. Movement itself happens in Room.moveAll.
function updateBot(bot, room) {
  if (!bot.alive || bot.frozen > 0) return;
  const head = bot.segs[0];
  const { W, H } = room;
  bot.botWanderTick++;

  if (room.zone && U.dist(head, room.zone) > room.zone.r - 350) {
    bot.targetAngle = Math.atan2(room.zone.y - head.y, room.zone.x - head.x);
    bot.botState = 'zone';
    bot.boosting = false;
    return;
  }

  if (bot.botDodgeTick > 0) { bot.botDodgeTick--; return; }

  const others = room.aliveSnakes().filter(p => p !== bot);
  for (const other of others) {
    if (U.wrapDist2(head, other.segs[0], W, H) < 180 * 180) {
      const approach = Math.atan2(head.y - other.segs[0].y, head.x - other.segs[0].x);
      if (Math.abs(U.angleDiff(other.angle, approach)) < 0.85) {
        bot.targetAngle = bot.angle + (Math.random() < 0.5 ? 1.2 : -1.2);
        bot.botDodgeTick = 18;
        bot.boosting = false;
        return;
      }
    }
  }

  if (bot.segs.length > 60 && bot.botWanderTick % 25 === 0) {
    for (const other of others) {
      if (other.kind === 'human' && other.protect <= 0 && other.segs.length < bot.segs.length * 0.7) {
        const d = U.wrapDist2(head, other.segs[0], W, H);
        if (d < 480 * 480) {
          bot.targetAngle = Math.atan2(other.segs[0].y - head.y, other.segs[0].x - head.x);
          bot.botState = 'hunt';
          bot.boosting = d < 250 * 250;
          return;
        }
      }
    }
  }

  if (bot.botWanderTick % 18 === 0 && !bot.powerup) {
    for (const pu of room.powerups) {
      if (U.wrapDist2(head, pu, W, H) < 280 * 280) {
        bot.targetAngle = Math.atan2(pu.y - head.y, pu.x - head.x);
        bot.botState = 'powerup';
        return;
      }
    }
  }

  if (bot.botWanderTick > 18 + Math.floor(U.rnd(28))) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < room.food.length; i += 3) {
      const f = room.food[i];
      const d = U.wrapDist2(head, f, W, H);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best) bot.targetAngle = Math.atan2(best.y - head.y, best.x - head.x) + (Math.random() - 0.5) * 0.3;
    bot.botWanderTick = 0;
    bot.botState = 'forage';
  }
  bot.boosting = bot.botState === 'hunt' || (bot.segs.length > 80 && Math.random() < 0.05);
}

module.exports = { updateBot };
