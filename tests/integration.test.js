// Smoke-level integration test: bring up the real server, connect via
// socket.io-client, exercise the room lifecycle and a couple of validation
// edges, then tear it down. Catches regressions that unit tests miss
// (event names, payload shapes, validation wiring).
const path = require('path');
const { fork } = require('child_process');
const { io: ioClient } = require('socket.io-client');

let server, port;

beforeAll((done) => {
  port = 30000 + Math.floor(Math.random() * 10000);
  server = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', LOG_LEVEL: 'silent' },
    silent: true,
  });
  let ready = false;
  const onLine = () => { if (!ready) { ready = true; setTimeout(done, 250); } };
  server.stdout?.on('data', onLine);
  server.stderr?.on('data', onLine);
  // Hard fallback in case nothing is logged
  setTimeout(() => { if (!ready) { ready = true; done(); } }, 1500);
}, 10_000);

afterAll(() => { server?.kill('SIGTERM'); });

function connect() {
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function waitFor(socket, event, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

describe('socket.io integration', () => {
  test('getRooms returns lobby payloads', async () => {
    const c = connect();
    await waitFor(c, 'connect');
    c.emit('getRooms');
    const [rooms, daily, cfg] = await Promise.all([
      waitFor(c, 'roomList'),
      waitFor(c, 'dailyChallenge'),
      waitFor(c, 'gameConfig'),
    ]);
    expect(Array.isArray(rooms)).toBe(true);
    expect(daily).toHaveProperty('goal');
    expect(Array.isArray(cfg.LEVEL_XP)).toBe(true);
    expect(cfg.LEVEL_XP.length).toBeGreaterThan(0);
    c.close();
  });

  test('joinRoom rejects garbage room id', async () => {
    const c = connect();
    await waitFor(c, 'connect');
    c.emit('joinRoom', { roomId: 'not-valid', name: 'p1' });
    const err = await waitFor(c, 'error');
    expect(err).toMatch(/invalid|room/i);
    c.close();
  });

  test('input with NaN angle is silently dropped (no crash)', async () => {
    const c = connect();
    await waitFor(c, 'connect');
    c.emit('createRoom', { name: 'p1', mode: 'classic', mapId: 'classic' });
    await waitFor(c, 'joined');
    // No throw, no disconnect — server should just ignore the bad input
    c.emit('input', { angle: NaN, boosting: true });
    c.emit('input', { angle: Infinity, boosting: false });
    c.emit('input', { angle: 'pizza', boosting: false });
    // Wait a short moment then assert we're still alive (state still flowing)
    await new Promise((r) => setTimeout(r, 200));
    expect(c.connected).toBe(true);
    c.close();
  });

  test('ranked without login is refused', async () => {
    const c = connect();
    await waitFor(c, 'connect');
    c.emit('createRoom', { name: 'anon', mode: 'ranked', mapId: 'classic' });
    const err = await waitFor(c, 'error');
    expect(err).toMatch(/login|ranked/i);
    c.close();
  });

  test('chat rate-limit fires after a burst', async () => {
    const c = connect();
    await waitFor(c, 'connect');
    c.emit('createRoom', { name: 'p1', mode: 'classic', mapId: 'classic' });
    await waitFor(c, 'joined');
    let limited = null;
    c.on('rateLimited', (msg) => { limited = msg; });
    // The configured chat budget is 3/sec — 20 in a row should hit it
    for (let i = 0; i < 20; i++) c.emit('chat', 'hi ' + i);
    await new Promise((r) => setTimeout(r, 400));
    expect(limited).not.toBeNull();
    expect(limited.action).toBe('chat');
    c.close();
  });

  test('GET /healthz responds 200 with metrics', async () => {
    const http = require('http');
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/healthz`, (r) => {
        let buf = ''; r.on('data', (c) => (buf += c)); r.on('end', () => resolve(buf));
      }).on('error', reject);
    });
    const json = JSON.parse(body);
    expect(json.status).toBe('ok');
    expect(typeof json.players).toBe('number');
  });
});
