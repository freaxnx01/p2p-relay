import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startRelay } from '../server.js';

const relays = [];
async function relay(opts = {}) {
  const r = await startRelay({ port: 0, log: () => {}, ...opts });
  relays.push(r);
  return r;
}
after(async () => { for (const r of relays) await r.close(); });

// Collects frames in order; next() waits for the next one.
function client(r, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${r.port}/`, { headers });
  const queue = [], waiters = [];
  const c = { ws, closed: null };
  ws.on('message', (d) => { const f = JSON.parse(d.toString()); const w = waiters.shift(); w ? w(f) : queue.push(f); });
  c.closedP = new Promise((res) => ws.on('close', (code) => { c.closed = code; res(code); }));
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.next = () => new Promise((res, rej) => {
    if (queue.length) return res(queue.shift());
    const t = setTimeout(() => rej(new Error('timeout waiting for frame')), 2000);
    waiters.push((f) => { clearTimeout(t); res(f); });
  });
  c.send = (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  return c;
}
const create = { t: 'create', v: 1, game: 'rhyflitzer', prefix: 'RHY', max: 3 };

async function hostRoom(r, max = 3, game = 'rhyflitzer') {
  const h = client(r); await h.open;
  h.send({ ...create, max, game });
  const created = await h.next();
  return { h, created };
}

test('contractExample_fullExchange', async () => {
  const r = await relay();
  const host = client(r); await host.open;
  host.send(create);
  const created = await host.next();
  assert.equal(created.t, 'created');
  assert.match(created.room, /^RHY-[0-9]{4}$/);
  assert.equal(created.ttl, 3600);

  const guest = client(r); await guest.open;
  guest.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  assert.deepEqual(await guest.next(), { t: 'joined', peer: 1 });
  assert.deepEqual(await host.next(), { t: 'guest', peer: 1 });

  host.send({ t: 'signal', to: 1, data: 'R2H.offer' });
  assert.deepEqual(await guest.next(), { t: 'signal', from: 0, data: 'R2H.offer' });
  guest.send({ t: 'signal', to: 0, data: 'R2G.answer' });
  assert.deepEqual(await host.next(), { t: 'signal', from: 1, data: 'R2G.answer' });

  guest.ws.close();
  assert.deepEqual(await host.next(), { t: 'left', peer: 1 });

  const guest2 = client(r); await guest2.open;
  guest2.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  assert.deepEqual(await guest2.next(), { t: 'joined', peer: 2 }, 'ids never reused');
  await host.next();
  host.ws.close();
  assert.deepEqual(await guest2.next(), { t: 'closed' });
  await guest2.closedP;
});

test('signal_spoofedFrom_isOverwrittenByRelay', async () => {
  const r = await relay();
  const { h, created } = await hostRoom(r);
  const g = client(r); await g.open;
  g.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  await g.next(); await h.next();
  g.send({ t: 'signal', to: 0, data: 'x', from: 0 });
  assert.deepEqual(await h.next(), { t: 'signal', from: 1, data: 'x' });
});

test('signal_toUnknownPeer_droppedSilently_guestCannotReachGuest', async () => {
  const r = await relay();
  const { h, created } = await hostRoom(r);
  const g1 = client(r), g2 = client(r); await g1.open; await g2.open;
  g1.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room }); await g1.next(); await h.next();
  g2.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room }); await g2.next(); await h.next();
  h.send({ t: 'signal', to: 9, data: 'lost' });
  g1.send({ t: 'signal', to: 2, data: 'sneaky' });
  h.send({ t: 'signal', to: 2, data: 'ok' });
  assert.deepEqual(await g2.next(), { t: 'signal', from: 0, data: 'ok' });
});

test('rooms_sameCodeInTwoGames_areTwoRooms', async () => {
  const r = await relay();
  const a = await hostRoom(r, 3, 'alpha');
  const g = client(r); await g.open;
  g.send({ t: 'join', v: 1, game: 'beta', room: a.created.room });
  assert.deepEqual(await g.next(), { t: 'error', code: 'no-room' });
  assert.equal(await g.closedP, 1000);
});

test('join_unknownRoom_noRoomThenClose', async () => {
  const r = await relay();
  const g = client(r); await g.open;
  g.send({ t: 'join', v: 1, game: 'rhyflitzer', room: 'RHY-0000' });
  assert.deepEqual(await g.next(), { t: 'error', code: 'no-room' });
  await g.closedP;
});

test('join_fullRoom_fullThenClose', async () => {
  const r = await relay();
  const { h, created } = await hostRoom(r, 1);
  const g1 = client(r); await g1.open;
  g1.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room }); await g1.next(); await h.next();
  const g2 = client(r); await g2.open;
  g2.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  assert.deepEqual(await g2.next(), { t: 'error', code: 'full' });
  await g2.closedP;
});

test('firstFrame_notCreateOrJoin_badThenClose', async () => {
  const r = await relay();
  const c = client(r); await c.open;
  c.send({ t: 'signal', to: 0, data: 'x' });
  assert.deepEqual(await c.next(), { t: 'error', code: 'bad' });
  await c.closedP;
});

test('create_wrongVersion_badThenClose', async () => {
  const r = await relay();
  const c = client(r); await c.open;
  c.send({ ...create, v: 2 });
  assert.deepEqual(await c.next(), { t: 'error', code: 'bad' });
  await c.closedP;
});

test('afterRole_unknownTypeAndSecondCreate_badKeepsSocket', async () => {
  const r = await relay();
  const { h } = await hostRoom(r);
  h.send({ t: 'eval' });
  assert.deepEqual(await h.next(), { t: 'error', code: 'bad' });
  h.send(create);
  assert.deepEqual(await h.next(), { t: 'error', code: 'bad' });
  h.send({ t: 'signal', to: 1, data: '' });
  assert.deepEqual(await h.next(), { t: 'error', code: 'bad' });
  assert.equal(h.closed, null);
});

test('invalidJson_closes1008', async () => {
  const r = await relay();
  const c = client(r); await c.open;
  c.send('not json');
  assert.equal(await c.closedP, 1008);
});

test('binaryFrame_closes1008', async () => {
  const r = await relay();
  const c = client(r); await c.open;
  c.ws.send(Buffer.from([1, 2, 3]));
  assert.equal(await c.closedP, 1008);
});

test('oversizeFrame_over20000chars_closes1008', async () => {
  const r = await relay();
  const { h } = await hostRoom(r);
  h.send(JSON.stringify({ t: 'signal', to: 1, data: 'x'.repeat(20_001) }));
  assert.equal(await h.closedP, 1008);
});

test('oversizeData_over16000chars_bad', async () => {
  const r = await relay();
  const { h } = await hostRoom(r);
  h.send({ t: 'signal', to: 1, data: 'x'.repeat(16_001) });
  assert.deepEqual(await h.next(), { t: 'error', code: 'bad' });
});

test('rateLimit_tooManyCreates_rateThenClose', async () => {
  const r = await relay({ limits: { create: 2, join: 100, frames: 1000 } });
  await hostRoom(r); await hostRoom(r);
  const c = client(r); await c.open;
  c.send(create);
  assert.deepEqual(await c.next(), { t: 'error', code: 'rate' });
  await c.closedP;
});

test('rateLimit_tooManyJoins_rate', async () => {
  const r = await relay({ limits: { create: 100, join: 1, frames: 1000 } });
  const { created } = await hostRoom(r);
  const g1 = client(r); await g1.open;
  g1.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  assert.equal((await g1.next()).t, 'joined');
  const g2 = client(r); await g2.open;
  g2.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  assert.deepEqual(await g2.next(), { t: 'error', code: 'rate' });
  await g2.closedP;
});

test('rateLimit_tooManyFrames_rateThenClose', async () => {
  const r = await relay({ limits: { create: 100, join: 100, frames: 3 } });
  const { h } = await hostRoom(r); // create frame counts as 1
  h.send({ t: 'signal', to: 1, data: 'a' });
  h.send({ t: 'signal', to: 1, data: 'b' });
  h.send({ t: 'signal', to: 1, data: 'c' });
  assert.deepEqual(await h.next(), { t: 'error', code: 'rate' });
  await h.closedP;
});

test('trustProxy_xForwardedForFirstHop_isRateKey', async () => {
  const r = await relay({ trustProxy: true, limits: { create: 1, join: 100, frames: 1000 } });
  const a = client(r, { 'x-forwarded-for': '1.1.1.1, 10.0.0.1' }); await a.open;
  a.send(create); assert.equal((await a.next()).t, 'created');
  const b = client(r, { 'x-forwarded-for': '2.2.2.2' }); await b.open;
  b.send(create); assert.equal((await b.next()).t, 'created', 'different client IP');
  const c = client(r, { 'x-forwarded-for': '1.1.1.1, 99.9.9.9' }); await c.open;
  c.send(create); assert.deepEqual(await c.next(), { t: 'error', code: 'rate' });
});

test('noTrustProxy_xForwardedForIgnored', async () => {
  const r = await relay({ limits: { create: 1, join: 100, frames: 1000 } });
  const a = client(r, { 'x-forwarded-for': '1.1.1.1' }); await a.open;
  a.send(create); await a.next();
  const b = client(r, { 'x-forwarded-for': '2.2.2.2' }); await b.open;
  b.send(create);
  assert.deepEqual(await b.next(), { t: 'error', code: 'rate' });
});

test('room_ttlElapsed_expiredToEveryoneThenClosed', async () => {
  const r = await relay({ ttlMs: 150 });
  const { h, created } = await hostRoom(r);
  assert.equal(created.ttl, 0, 'ttl reported in whole seconds');
  const g = client(r); await g.open;
  g.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room });
  await g.next(); await h.next();
  assert.deepEqual(await h.next(), { t: 'expired' });
  assert.deepEqual(await g.next(), { t: 'expired' });
  await Promise.all([h.closedP, g.closedP]);
});

test('create_namespaceExhausted_taken', async () => {
  const r = await relay({ maxRoomsPerPrefix: 1 });
  await hostRoom(r);
  const c = client(r); await c.open;
  c.send(create);
  assert.deepEqual(await c.next(), { t: 'error', code: 'taken' });
  await c.closedP;
});

test('logs_neverContainFramesRoomCodesOrIps', async () => {
  const lines = [];
  const r = await relay({ log: (l) => lines.push(l) });
  const { h, created } = await hostRoom(r);
  const g = client(r); await g.open;
  g.send({ t: 'join', v: 1, game: 'rhyflitzer', room: created.room }); await g.next(); await h.next();
  h.send({ t: 'signal', to: 1, data: 'SECRET-PAYLOAD' }); await g.next();
  h.ws.close(); await g.closedP;
  assert.ok(lines.length >= 4, 'logs something human-readable');
  const all = lines.join('\n');
  assert.ok(!all.includes('SECRET-PAYLOAD'));
  assert.ok(!all.includes(created.room));
  assert.ok(!all.includes('127.0.0.1'));
});
