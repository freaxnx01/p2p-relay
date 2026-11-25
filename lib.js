// Pure helpers for the relay: room codes, frame validation, rate limiting.
// Protocol: https://github.com/freaxnx01/game-rhyflitzer/blob/main/docs/relay-protocol.md

export const FRAME_MAX = 20_000;
export const DATA_MAX = 16_000;
export const MAX_GUESTS = 8;
export const ROOM_RE = /^[A-Z]{3}-[0-9]{4}$/;
const GAME_RE = /^[a-z0-9-]{1,32}$/;
const PREFIX_RE = /^[A-Z]{3}$/;
const BAD = Object.freeze({ t: 'bad' });

// Picks a free `PPP-NNNN` at random; null when the prefix has no free code left.
export function generateCode(prefix, isTaken, rand = Math.random) {
  const code = (n) => `${prefix}-${String(n).padStart(4, '0')}`;
  const start = Math.floor(rand() * 10_000);
  for (let i = 0; i < 10_000; i++) {
    const candidate = code((start + i) % 10_000);
    if (!isTaken(candidate)) return candidate;
  }
  return null;
}

// Returns a fresh, validated frame ({t:'create'|'join'|'signal',...}), {t:'bad'} for a
// well-formed JSON message that breaks the contract, or null when the text is not JSON. Never throws.
export function parseClientFrame(raw) {
  let f;
  try { f = JSON.parse(raw); } catch { return null; }
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return BAD;
  switch (f.t) {
    case 'create': return parseCreate(f);
    case 'join': return parseJoin(f);
    case 'signal': return parseSignal(f);
    default: return BAD;
  }
}

function parseCreate(f) {
  if (f.v !== 1 || !GAME_RE.test(f.game) || !PREFIX_RE.test(f.prefix)) return BAD;
  if (!Number.isInteger(f.max) || f.max < 1) return BAD;
  return { t: 'create', game: f.game, prefix: f.prefix, max: Math.min(f.max, MAX_GUESTS) };
}

function parseJoin(f) {
  if (f.v !== 1 || !GAME_RE.test(f.game) || !ROOM_RE.test(f.room)) return BAD;
  return { t: 'join', game: f.game, room: f.room };
}

function parseSignal(f) {
  if (!Number.isInteger(f.to) || f.to < 0) return BAD;
  if (typeof f.data !== 'string' || f.data.length < 1 || f.data.length > DATA_MAX) return BAD;
  return { t: 'signal', to: f.to, data: f.data };
}

// Fixed-window counter per key (client IP).
export class RateLimiter {
  #limit; #windowMs; #hits = new Map();
  constructor(limit, windowMs = 60_000) { this.#limit = limit; this.#windowMs = windowMs; }
  get size() { return this.#hits.size; }
  allow(key, now = Date.now()) {
    const hit = this.#hits.get(key);
    if (!hit || now - hit.start >= this.#windowMs) {
      this.#hits.set(key, { start: now, count: 1 });
      return true;
    }
    hit.count += 1;
    return hit.count <= this.#limit;
  }
  sweep(now = Date.now()) {
    for (const [key, hit] of this.#hits) if (now - hit.start >= this.#windowMs) this.#hits.delete(key);
  }
}
