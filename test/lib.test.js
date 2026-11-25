import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, parseClientFrame, RateLimiter, ROOM_RE } from '../lib.js';

test('generateCode_freeCodes_matchesFormatAndPrefix', () => {
  const code = generateCode('RHY', () => false);
  assert.match(code, ROOM_RE);
  assert.ok(code.startsWith('RHY-'));
});

test('generateCode_skipsTakenCodes', () => {
  const taken = new Set(['RHY-0000', 'RHY-0001']);
  for (let i = 0; i < 200; i++) assert.ok(!taken.has(generateCode('RHY', (c) => taken.has(c), () => 0)));
});

test('generateCode_onlyOneFreeCodeLeft_findsIt', () => {
  const free = 'RHY-4242';
  assert.equal(generateCode('RHY', (c) => c !== free), free);
});

test('generateCode_namespaceFull_returnsNull', () => {
  assert.equal(generateCode('RHY', () => true), null);
});

test('parseClientFrame_validCreate_clampsMaxTo8', () => {
  const f = parseClientFrame('{"t":"create","v":1,"game":"rhyflitzer","prefix":"RHY","max":99}');
  assert.deepEqual(f, { t: 'create', game: 'rhyflitzer', prefix: 'RHY', max: 8 });
});

test('parseClientFrame_validJoinAndSignal', () => {
  assert.deepEqual(parseClientFrame('{"t":"join","v":1,"game":"g-1","room":"RHY-4827","x":1}'), { t: 'join', game: 'g-1', room: 'RHY-4827' });
  assert.deepEqual(parseClientFrame('{"t":"signal","to":2,"data":"R2H.x"}'), { t: 'signal', to: 2, data: 'R2H.x' });
});

test('parseClientFrame_invalid_returnsBadReasonNotThrow', () => {
  const bad = [
    '[]', 'null', '5', '{"t":"create","v":2,"game":"g","prefix":"RHY","max":1}',
    '{"t":"create","v":1,"game":"G","prefix":"RHY","max":1}',
    '{"t":"create","v":1,"game":"g","prefix":"rhy","max":1}',
    '{"t":"create","v":1,"game":"g","prefix":"RHY","max":0}',
    '{"t":"create","v":1,"game":"g","prefix":"RHY","max":1.5}',
    '{"t":"join","v":1,"game":"g","room":"RHY-48"}',
    '{"t":"signal","to":-1,"data":"x"}', '{"t":"signal","to":1,"data":""}',
    JSON.stringify({ t: 'signal', to: 1, data: 'x'.repeat(16001) }),
    '{"t":"signal","to":1,"data":5}',
  ];
  for (const raw of bad) assert.deepEqual(parseClientFrame(raw), { t: 'bad' }, raw);
});

test('parseClientFrame_notJson_returnsNull', () => {
  assert.equal(parseClientFrame('nope'), null);
});

test('parseClientFrame_unknownType_isBad', () => {
  assert.deepEqual(parseClientFrame('{"t":"eval"}'), { t: 'bad' });
});

test('RateLimiter_overLimit_blocksUntilWindowPasses', () => {
  const rl = new RateLimiter(2, 60_000);
  assert.ok(rl.allow('a', 0));
  assert.ok(rl.allow('a', 1));
  assert.ok(!rl.allow('a', 2));
  assert.ok(rl.allow('b', 2), 'other key unaffected');
  assert.ok(rl.allow('a', 60_001), 'window passed');
});

test('RateLimiter_sweep_dropsStaleKeys', () => {
  const rl = new RateLimiter(1, 1000);
  rl.allow('a', 0);
  rl.sweep(5000);
  assert.equal(rl.size, 0);
});
