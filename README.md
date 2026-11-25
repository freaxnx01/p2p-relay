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

`compose.yaml` carries the Traefik labels for `relay.freaxnx01.ch`. Before the first `docker compose up -d --build`:

- replace `CHANGE_ME_certresolver` with the certresolver name of the VPS Traefik,
- replace the `proxy` network name (marked `CHANGE_ME_network`) with the network Traefik shares with its services,
- add the Cloudflare DNS record for `relay.freaxnx01.ch`.

Traefik proxies WebSockets without extra configuration. Clients use `wss://relay.freaxnx01.ch/`.

## License

MIT
