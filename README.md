# p2p-relay

Tiny game-agnostic WebSocket signaling relay. Players of a browser game connect with one short room code (e.g. `RHY-4827`) instead of swapping WebRTC offer/answer codes by hand. The relay only forwards opaque signaling strings between a room's host and its guests; game traffic stays peer-to-peer. First consumer: [game-rhyflitzer](https://github.com/freaxnx01/game-rhyflitzer) (#1198).

Protocol: **v1**, [`docs/relay-protocol.md`](https://github.com/freaxnx01/game-rhyflitzer/blob/main/docs/relay-protocol.md) in game-rhyflitzer is the contract. Decision record: [ADR 0001](https://github.com/freaxnx01/game-rhyflitzer/blob/main/docs/adr/0001-own-signaling-relay.md).

## Run locally

```bash
npm ci
npm start        # listens on :8080
npm test
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `TRUST_PROXY` | unset | `1` = take the client IP from the first hop of `X-Forwarded-For` (only behind Traefik; otherwise clients could spoof their rate-limit key) |

Rate limits per IP and minute (create 10, join 30, frames 600) and the other limits are constants in `server.js` / `lib.js`.

## Privacy

Logs go to stdout as plain sentences. They never contain frame contents, room codes or client IPs.

## Deploy (VPS-DE)

Live at `wss://relay.freaxnx01.ch/` since 2026-11-25.

- Runs on VPS-DE (ionos1) as the `p2p-relay` block of the shared stack in `mydocker-compose`
  (`production/vserver/docker-compose.yml`), built from this repo's `main`; subdomain from
  `SUBDOMAIN_RELAY=relay` in that stack's `.env`.
- Traefik: network `web`, entrypoint `web-secure`, certresolver `default`, middleware `myRateLimit@file`.
- DNS: Cloudflare CNAME `relay` → `freaxnx01.ch`, DNS only.
- Update after a merge to `main`, from `~/mydocker` on ionos1:
  `docker compose build p2p-relay && docker compose up -d --no-deps p2p-relay`.

`compose.yaml` here is the same setup for running the relay standalone.
Traefik proxies WebSockets without extra configuration.

## License

MIT
