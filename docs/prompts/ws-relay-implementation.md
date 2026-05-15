# Implementation prompt — WS relay + browser client wiring

> **Audience:** an AI coding agent walking in cold.
> **Scope:** add a tiny local WS relay (Node) and fill in the existing
> `WebSocketTransport` stub on the browser side. No source refactor.

---

## Mission

The MMB team's spec assumes the aquarium hosts a WS server at
`ws://localhost:8080/ws` that they push to. Our aquarium is a browser app
and can't host a server, so we add a **tiny Node WS relay** that bridges
MMB → browser. Same URL, broadcasts every incoming frame to all other
connected clients. State-less, no protocol of its own, ~30 lines.

Then we fill in the browser-side `WebSocketTransport.connect()` (already
stubbed in `src/transport.ts`) so the aquarium consumes from the relay.

---

## Before you touch any code

Read in order:

1. `CLAUDE.md` — architecture, conventions, test contract.
2. `docs/integration-spec.md` — the MMB ↔ aquário wire protocol (the relay
   does not parse or validate, just forwards bytes).
3. `src/transport.ts` — the stub you'll fill in.
4. `src/main.ts` — where you'll branch between `SimulatorTransport` and
   `WebSocketTransport`.

If anything is ambiguous, **ask before guessing.**

---

## Deliverables

### New files

| Path                   | Purpose                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/ws-relay.mjs` | Node ES module. Tiny WS server on `ws://localhost:8080/ws`. Broadcasts every frame to all other clients. |
| `.env.example`         | `VITE_WS_URL=ws://localhost:8080/ws` plus the existing audio block (preserve what's there).              |

### Modified files

| Path               | Change                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`     | Add `ws` as a **runtime dependency** (the relay uses it). Add scripts: `"relay": "node scripts/ws-relay.mjs"`. No `concurrently` — two terminals is fine.                                                                                                                                                            |
| `src/transport.ts` | Implement `WebSocketTransport.connect()` — open the socket, parse incoming JSON, run through the existing `isAppMessage` guard, call `this.emit(msg)`. On `close`, schedule reconnect with exponential backoff (1, 2, 5, 10, 30 s, ±20 % jitter, no max retries). On `error`, log and let the `close` handler retry. |
| `src/main.ts`      | Branch on `import.meta.env.VITE_WS_URL`. If set, instantiate `WebSocketTransport(url)` and call `.connect()`; if not, keep using `SimulatorTransport` (current default). Both feed `world.handleMessage` the same way.                                                                                               |
| `CLAUDE.md`        | Add a short subsection under the architecture explaining the relay: "the browser can't host WS, so a Node relay bridges MMB to the page; run `npm run relay` alongside `npm run dev`."                                                                                                                               |

### Out-of-scope

- No tests for the relay itself in this round (it's 30 lines, behavior is "echo to peers"). The smoke test below covers it.
- No e2e test against a live MMB. We rely on the smoke + manual.
- No auth, no TLS, no multi-tenant routing. All local.
- No reconnect on the relay's side. If the relay restarts, both MMB and the browser reconnect on their own.

---

## Relay shape (guidance, not prescription)

You write the file; below is the contract it must satisfy. Use the `ws`
npm package.

- Listens on host `127.0.0.1`, port `8080`, path `/ws`. Port overridable via `process.env.PORT`, default `8080`.
- On any frame received from any client, forwards the same bytes to **every other open client**. Don't echo back to the sender. Don't parse or validate; the relay is transparent.
- Logs connect / disconnect with the current peer count.
- Clean shutdown on `SIGINT` / `SIGTERM`: close all sockets, exit 0.
- No state, no buffering, no last-message cache. If the browser reloads while MMB is still connected, the browser will be blank until the next state/event. Acceptable for v1.

---

## `WebSocketTransport.connect()` contract

You write the implementation; below is what it must do.

1. `new WebSocket(this.url)`.
2. `addEventListener('message', ev => …)` — `JSON.parse(ev.data)`, run through `isAppMessage`, call `this.emit(msg)` on success, `console.warn` on failure (drop frame, keep socket alive).
3. `addEventListener('open', …)` — log, reset the backoff counter.
4. `addEventListener('close', …)` — log, schedule a reconnect via `setTimeout` using the backoff curve: 1s, 2s, 5s, 10s, 30s, then 30s thereafter, each with ±20 % jitter.
5. `addEventListener('error', …)` — `console.warn`. Don't manually trigger reconnect here — `close` will fire right after and handle it.
6. Provide a `close()` that calls `this.ws?.close()` and cancels any pending reconnect timer.

---

## Acceptance criteria

Verify in order:

- [ ] `npm install` succeeds and `ws` is in `dependencies` (not devDependencies).
- [ ] `npm run typecheck` passes unchanged.
- [ ] `npm run test:unit` passes unchanged (no new tests required this round).
- [ ] `npm run relay` starts and logs `listening on ws://127.0.0.1:8080/ws`.
- [ ] **Manual smoke #1** (relay echo): in two terminals, open `wscat -c ws://localhost:8080/ws` in each. Send `{"type":"event","id":"x","kind":"born"}` from one — the other receives the same string verbatim. The sender does NOT see its own echo.
- [ ] **Manual smoke #2** (end-to-end with the simulator playing MMB): start the relay (`npm run relay`), then in a second terminal `npm run dev`. Open the browser at the dev URL. With `VITE_WS_URL=ws://localhost:8080/ws` in `.env.local`, the page boots using `WebSocketTransport` (the manual sim buttons stay there but won't drive state). Use `wscat` to push a `born` and a couple of `state` messages — the corresponding Meeseeks should appear and decay on the screen.
- [ ] **Manual smoke #3** (resilience): kill the relay (`Ctrl+C`), browser console shows the close + a reconnect attempt; restart the relay, browser reconnects within a few seconds.

---

## Pitfalls

1. **`ws` runtime, not dev.** The relay script uses it at runtime. Putting it in `devDependencies` will fail in a clean install when running the relay.
2. **JSON.parse can throw.** Always wrap in try/catch. A malformed frame must not kill the connection.
3. **`WebSocket` close event fires on errors too**, so the close handler's reconnect logic is the single source of truth. Don't duplicate reconnect logic in the error handler.
4. **Reconnect backoff is monotonic until reset.** Reset the counter only on a successful `open` (not on `connect()` call) — otherwise repeated quick disconnects will spam.
5. **Same host MMB and browser.** The relay binds to `127.0.0.1`, not `0.0.0.0`. If MMB or the browser were ever on a different machine, this would need to change — but it's localhost, so 127.0.0.1 is intentional.
6. **No emoji in `console.log`s** — keep relay output readable in dumb terminals.
7. **Don't commit until the human reviews.** Leave the changes in the working tree and report.

---

## How to report when done

In chat, list:

- Files created / modified.
- Output of the three manual smoke tests.
- Output of `npm run typecheck` and `npm run test:unit`.
- Proposed commit message (Conventional Commits, type `feat(transport)` or `feat(ws)`, body explains the relay decision and the WebSocketTransport wiring).

**Do not** `git commit`, `git add` final, or `git tag`. Wait for explicit go-ahead.
