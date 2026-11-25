// Game-agnostic signaling relay, protocol v1. Forwards opaque strings between a room's host and guests.
// Contract: https://github.com/freaxnx01/game-rhyflitzer/blob/main/docs/relay-protocol.md
// Privacy: never logs frame contents, room codes or client IPs.
import { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';
import { generateCode, parseClientFrame, RateLimiter, FRAME_MAX } from './lib.js';

const DEFAULT_LIMITS = { create: 10, join: 30, frames: 600 }; // per IP per minute

export async function startRelay({
  port = 8080, trustProxy = false, limits = {}, ttlMs = 3_600_000, pingMs = 30_000,
  maxRoomsPerPrefix = 10_000, log = (line) => console.log(line),
} = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const rate = { create: new RateLimiter(lim.create), join: new RateLimiter(lim.join), frames: new RateLimiter(lim.frames) };
  const rooms = new Map(); // "<game>/<code>" -> { host, guests: Map(peer -> ws), max, nextPeer, timer, game, prefix }
  const wss = new WebSocketServer({ port, maxPayload: FRAME_MAX * 4 }); // bytes; chars are checked below
  await new Promise((resolve) => wss.once('listening', resolve));

  const send = (ws, frame) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame)); };
  const fail = (ws, code, close = true) => { send(ws, { t: 'error', code }); if (close) ws.close(1000); };
  const clientIp = (req) => (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
  const prefixCount = (game, prefix) => [...rooms.values()].filter((r) => r.game === game && r.prefix === prefix).length;

  function createRoom(ws, f) {
    if (prefixCount(f.game, f.prefix) >= maxRoomsPerPrefix) return fail(ws, 'taken');
    const code = generateCode(f.prefix, (c) => rooms.has(`${f.game}/${c}`));
    if (!code) return fail(ws, 'taken');
    const key = `${f.game}/${code}`;
    const room = { key, game: f.game, prefix: f.prefix, host: ws, guests: new Map(), max: f.max, nextPeer: 1 };
    room.timer = setTimeout(() => expire(room), ttlMs);
    rooms.set(key, room);
    ws.session = { role: 'host', room };
    send(ws, { t: 'created', room: code, ttl: Math.round(ttlMs / 1000) });
    log(`Room created in game "${f.game}", ${rooms.size} room(s) open.`);
  }

  function joinRoom(ws, f) {
    const room = rooms.get(`${f.game}/${f.room}`);
    if (!room) return fail(ws, 'no-room');
    if (room.guests.size >= room.max) return fail(ws, 'full');
    const peer = room.nextPeer++;
    room.guests.set(peer, ws);
    ws.session = { role: 'guest', room, peer };
    send(ws, { t: 'joined', peer });
    send(room.host, { t: 'guest', peer });
    log(`Guest joined a room in game "${f.game}".`);
  }

  function relaySignal(ws, f) {
    const { role, room, peer } = ws.session;
    let target;
    if (role === 'host') target = room.guests.get(f.to);
    else if (f.to === 0) target = room.host;
    if (target) send(target, { t: 'signal', from: role === 'host' ? 0 : peer, data: f.data });
  }

  function closeRoom(room, frame, why) {
    clearTimeout(room.timer);
    if (!rooms.delete(room.key)) return;
    for (const ws of [room.host, ...room.guests.values()]) { send(ws, frame); ws.close(1000); }
    log(`Room closed (${why}), ${rooms.size} room(s) open.`);
  }
  const expire = (room) => closeRoom(room, { t: 'expired' }, 'time is up');

  function onClose(ws) {
    const s = ws.session;
    if (!s) return;
    if (s.role === 'host') return closeRoom(s.room, { t: 'closed' }, 'host left');
    if (s.room.guests.delete(s.peer)) send(s.room.host, { t: 'left', peer: s.peer });
  }

  function onMessage(ws, req, data, isBinary) {
    const raw = isBinary ? null : data.toString();
    if (raw === null || raw.length > FRAME_MAX) return ws.close(1008);
    if (!rate.frames.allow(ws.ip)) return fail(ws, 'rate');
    const f = parseClientFrame(raw);
    if (!f) return ws.close(1008); // not JSON
    if (ws.session) return f.t === 'signal' ? relaySignal(ws, f) : fail(ws, 'bad', false);
    if (f.t === 'create' || f.t === 'join') {
      if (!rate[f.t].allow(ws.ip)) return fail(ws, 'rate');
      return f.t === 'create' ? createRoom(ws, f) : joinRoom(ws, f);
    }
    fail(ws, 'bad'); // first frame must be create or join
  }

  wss.on('connection', (ws, req) => {
    ws.ip = clientIp(req);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, isBinary) => onMessage(ws, req, data, isBinary));
    ws.on('close', () => onClose(ws));
    ws.on('error', () => ws.terminate());
  });

  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
    for (const rl of Object.values(rate)) rl.sweep();
  }, pingMs);

  const address = wss.address();
  log(`Relay listening on port ${address.port}${trustProxy ? ' (trusting X-Forwarded-For)' : ''}.`);
  return {
    port: address.port,
    async close() {
      clearInterval(pinger);
      for (const room of rooms.values()) clearTimeout(room.timer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await startRelay({ port: Number(process.env.PORT) || 8080, trustProxy: process.env.TRUST_PROXY === '1' });
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
