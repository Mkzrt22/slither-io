'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../src/game/room');
const { runTicks } = require('./helpers');

const profile = name => ({ name, skin: 'solid', customSkin: null, cosmetics: null, emotes: ['😂'] });
const longBody = (p, n) => { const h = p.segs[0]; p.segs = Array.from({ length: n }, (_, i) => ({ x: (h.x + i * 2.8) % 4000, y: h.y })); p.score = n; };

test('a big snake death keeps its food burst', () => {
  const room = new Room({ id: 't', mode: 'classic' });
  const p = room.addHuman({ socketId: null, profile: profile('big') });
  longBody(p, 900);
  const before = room.food.length;
  room.killSnake(p, { reason: 'self' });
  room.maintainWorld();
  assert.ok(room.food.length >= before + 440, `food kept: ${room.food.length - before}`);
});

test('boosting costs length, not only score', () => {
  const room = new Room({ id: 't', mode: 'classic' });
  const p = room.addHuman({ socketId: null, profile: profile('b') });
  longBody(p, 100);
  room.food = [];
  room.powerups = [];
  room.portals = [];
  p.protect = 1e9;
  p.boosting = true;
  for (let i = 0; i < 16; i++) room.moveAll();
  assert.equal(p.segs.length, 98);
});

test('second wind survives exactly one fatal hit', () => {
  const room = new Room({ id: 't', mode: 'classic' });
  room.obstacles = [];
  const a = room.addHuman({ socketId: null, profile: profile('a') });
  const b = room.addHuman({ socketId: null, profile: profile('b') });
  a.protect = b.protect = 0;
  a.secondWind = true;
  a.segs[0] = { x: b.segs[20].x, y: b.segs[20].y }; // far enough from b's head
  room.collide();
  assert.equal(a.alive, true);
  assert.equal(a.powerup, 'ghost_pu');
  a.powerup = null;
  room.collide();
  assert.equal(a.alive, false);
  assert.equal(b.killCount, 1);
});

test('food does not count towards the power-up challenge', () => {
  const room = new Room({ id: 't', mode: 'classic' });
  const p = room.addHuman({ socketId: null, profile: profile('p') });
  room.food = [{ id: 1, x: p.segs[0].x, y: p.segs[0].y, sz: 6, color: '#fff' }];
  room.eatFood(p, p.segs[0]);
  assert.equal(p.ch.food, 1);
  assert.equal(p.ch.powerups, 0);
});

test('classic rooms have no shrinking zone and idle without humans', () => {
  const room = new Room({ id: 't', mode: 'classic' });
  assert.equal(room.zone, null);
  runTicks(room, 10);
  assert.equal(room.tickCount, 0);
});

test('royale: waiting → countdown → playing with bots, spawn inside the zone', () => {
  const room = new Room({ id: 't', mode: 'royale' });
  assert.equal(room.phase, 'waiting');
  const p = room.addHuman({ socketId: 'sock', profile: profile('p') });
  room.tick();
  assert.equal(room.phase, 'countdown');
  assert.equal(room.aliveSnakes().length, 6);
  for (const s of room.aliveSnakes()) assert.ok(Math.hypot(s.segs[0].x - room.zone.x, s.segs[0].y - room.zone.y) < room.zone.r);
  runTicks(room, 5 * 25 + 1);
  assert.equal(room.phase, 'playing');
  room.killSnake(p, { reason: 'zone' });
  room.checkRoundEnd();
  assert.equal(room.phase, 'ended');
  runTicks(room, 6 * 25 + 2);
  assert.equal(room.phase, 'countdown', 'next round starts');
});

test('score rounds reset after a win', () => {
  const room = new Room({ id: 't', mode: 'score' });
  const p = room.addHuman({ socketId: 's', profile: profile('p') });
  p.score = 250;
  room.checkRoundEnd();
  assert.equal(room.phase, 'ended');
  runTicks(room, 8 * 25 + 2);
  assert.equal(room.phase, 'playing');
  assert.equal(p.alive, true, 'spawn protection keeps the fresh snake alive');
  assert.ok(p.score < 40, 'score was reset (it may already have eaten a bite)');
});

test('leaving removes the player from the room', () => {
  const room = new Room({ id: 't', mode: 'classic' });
  const p = room.addHuman({ socketId: 's', profile: profile('p') });
  room.removeHuman(p);
  assert.equal(room.players.size, 0);
  assert.ok(room.emptySince);
});

test('state packets only include what is near the viewer', () => {
  const sent = [];
  const net = { toSocket: (sid, ev, data) => sent.push({ sid, ev, data }), toRoom: () => {} };
  const room = new Room({ id: 't', mode: 'classic', net });
  const p = room.addHuman({ socketId: 's', profile: profile('p') });
  room.tick();
  const pkt = sent.filter(m => m.ev === 's').pop().data;
  assert.ok(pkt.fd.length < room.food.length / 2, 'food is culled');
  assert.ok(pkt.sn.some(s => s.i === p.id), 'own snake is sent');
  const me = pkt.sn.find(s => s.i === p.id);
  assert.equal(me.g.length / 2, Math.ceil(p.segs.length / me.d) + ((p.segs.length - 1) % me.d ? 1 : 0));
  assert.ok(JSON.stringify(pkt).length < 15000);
});

test('ranked: quitting mid-round still counts as a loss', () => {
  const results = [];
  const room = new Room({ id: 't', mode: 'ranked', services: { onRankedEnd: (r, placements) => results.push(placements) } });
  const a = room.addHuman({ socketId: 'sa', userId: 1, profile: profile('a') });
  const b = room.addHuman({ socketId: 'sb', userId: 2, profile: profile('b') });
  room.tick();
  runTicks(room, 5 * 25 + 1);
  assert.equal(room.phase, 'playing');
  room.removeHuman(b); // rage quit
  room.checkRoundEnd();
  assert.deepEqual(results[0].map(p => p.userId), [1, 2]);
  assert.ok(a.alive);
});
