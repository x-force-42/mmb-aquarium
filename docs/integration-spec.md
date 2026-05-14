# Mr. Meeseeks Aquarium — Integration Spec

> Audience: the team writing the **producer** side of this integration
> (the system whose state the aquarium will visualize).
> Status: **interface frozen for v1**; transport-level details (URL, auth,
> heartbeat) are open and need decisions from the producer team — see the
> "Open questions" section at the end.

---

## What this is

The aquarium is a visualization front-end. Each item alive on screen — a
"Meeseeks" — represents one unit of work in your system. You produce a
stream of small JSON messages; the aquarium reflects those messages as
creatures being born, working, suffering, dying or being relieved.

You don't need to know how the aquarium renders — that's our problem. You
just need to push the right messages at the right time. The interface is
intentionally minimal: **three message types, five lifecycle events, one
continuous metric (health)**. Nothing else.

The contract is one-way: you push, we render. There are no client → server
messages in v1 (no acks, no requests, no commands back).

---

## Transport

- **Protocol:** WebSocket. Plain text frames carrying UTF-8 JSON, one
  message per frame.
- **URL pattern:** TBD by the producer team (see Open questions). The
  aquarium client takes it as a configuration parameter at boot, so any
  URL works.
- **Direction:** producer → aquarium only.
- **Reconnect:** the aquarium will reconnect on disconnect (exponential
  backoff, capped). The producer **must send a fresh `snapshot` as the
  first message on every new connection** — see "Operational contract"
  for why.

---

## Message schema

Every frame is a JSON object with a discriminator field `type`. Three values:

### 1. `snapshot` — full state, sent on connect

Tells the aquarium "this is the complete current state; drop everything
else." Used at connect time and whenever the producer needs to resync.

```json
{
  "type": "snapshot",
  "meeseeks": [
    {
      "id": "task-42",
      "health": 0.83,
      "isFreakingOut": false,
      "name": "Mr. Meeseeks",
      "task": "rebalance shard 7"
    },
    {
      "id": "task-118",
      "health": 0.21,
      "isFreakingOut": true
    }
  ]
}
```

Field by field:

| Field            | Type                | Required | Notes                                                              |
| ---------------- | ------------------- | :------: | ------------------------------------------------------------------ |
| `meeseeks`       | array of entries    | yes      | May be empty (`[]`) — that's a valid "nothing is alive" snapshot.   |
| `id`             | string              | yes      | Stable per work unit. Should be **unique** across the producer.    |
| `health`         | number `[0, 1]`     | no       | Defaults to `1`. Clamped on receipt — out-of-range values get pinned to `[0, 1]`. |
| `isFreakingOut`  | boolean             | no       | Defaults to `false`.                                               |
| `name`           | string              | no       | Friendly label shown briefly above the sprite at birth.            |
| `task`           | string              | no       | Friendly description of what the unit is doing. Currently surfaced only on hover/inspection. |

### 2. `state` — continuous health update

Tells the aquarium "this unit's health is now X." Health is **absolute**,
not a delta. The aquarium will animate the color transition from old to new.

```json
{ "type": "state", "id": "task-42", "health": 0.74 }
```

| Field    | Type            | Required | Notes                                  |
| -------- | --------------- | :------: | -------------------------------------- |
| `id`     | string          | yes      | Must match an existing Meeseeks.       |
| `health` | number `[0, 1]` | yes      | Absolute new value. Clamped on receipt.|

Unknown `id` → silently dropped (the aquarium logs a warning; the producer
is expected to be the source of truth, so we don't ask). Same-value updates
are idempotent — sending the current health again is a no-op.

### 3. `event` — discrete lifecycle event

Tells the aquarium "something discrete happened to this unit." Triggers a
specific animation (and a voice clip, see the audio system).

```json
{ "type": "event", "id": "task-42", "kind": "born", "name": "Mr. Meeseeks", "task": "rebalance shard 7" }
```

| Field    | Type     | Required | Notes                                              |
| -------- | -------- | :------: | -------------------------------------------------- |
| `id`     | string   | yes      | The work unit this event applies to.               |
| `kind`   | enum     | yes      | One of `born`, `died_happy`, `died_defeated`, `freaking_out`, `recovered`. |
| `name`   | string   | no       | Only used on `born`. Sets the floating-name label. |
| `task`   | string   | no       | Only used on `born`. Sets the task hover label.    |

Semantic of each `kind`:

| `kind`            | Meaning                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `born`            | A new unit just started. Aquarium spawns a new sprite at full health.                                |
| `died_happy`      | Unit completed its work successfully. Sprite plays the celebratory death animation and disappears.   |
| `died_defeated`   | Unit failed / was given up on. Sprite plays the somber death animation and disappears.               |
| `freaking_out`    | Unit entered an error/crisis state. Sprite starts pulsing red, shaking, and (later) wailing.         |
| `recovered`       | Unit exited the freak-out state. Sprite calms down. The unit stays alive.                            |

The aquarium tracks `isFreakingOut` as a flag separate from `health` — a
unit can be at 90 % health and still freaking out, or at 5 % health and
calm.

---

## Operational contract

These are the guarantees the aquarium expects from the producer side, and
what the producer can expect from the aquarium.

| Topic                       | Contract                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ordering**                | Messages **for the same `id`** must arrive in causal order. Across IDs, ordering is irrelevant.                                                 |
| **Idempotency (born)**      | Duplicate `born` for an already-alive `id` is **silently dropped**. Don't worry about replays.                                                 |
| **Idempotency (state)**     | `state` with health equal to the current value is a **no-op**. Same is true if it lands before any `born` for that id (dropped).               |
| **Idempotency (freak)**     | `freaking_out` for an already-freaking unit is **dropped**. Same for `recovered` on a non-freaking unit.                                       |
| **Unknown id**              | Any `state` or `event` for an `id` the aquarium has never heard of is silently dropped.                                                        |
| **`snapshot` is a reset**   | When a `snapshot` arrives, the aquarium **wipes** its current state and re-emits births for each entry. Use this for resync, never as a delta. |
| **Connect resync**          | The producer **should** send a `snapshot` as the first message on every new connection. Without it, the aquarium starts empty until events flow. |
| **Backpressure**            | The aquarium can absorb ~1000 messages/sec without dropping. Beyond that, message frames may be deferred a frame (16 ms) but not dropped on our side. |
| **Buffering on disconnect** | The aquarium does **not** buffer producer-side. If you disconnect mid-burst, send a `snapshot` on reconnect rather than replaying events.       |
| **Client → server**         | None in v1. The aquarium is read-only. Future: maybe a "request snapshot" frame from the client. Not now.                                      |

---

## Example sequences

### Bring a unit to life, work it, complete it

```jsonc
// 0 ms
{ "type": "event", "id": "u-001", "kind": "born", "name": "Mr. Meeseeks", "task": "compile report" }

// 2_000 ms — health falling as the work consumes patience
{ "type": "state", "id": "u-001", "health": 0.8 }
// 4_000 ms
{ "type": "state", "id": "u-001", "health": 0.6 }
// 6_000 ms
{ "type": "state", "id": "u-001", "health": 0.5 }

// 6_500 ms — finished cleanly
{ "type": "event", "id": "u-001", "kind": "died_happy" }
```

### A unit gets stuck, recovers, gives up later

```jsonc
{ "type": "event", "id": "u-002", "kind": "born", "task": "open the jar" }
{ "type": "state", "id": "u-002", "health": 0.35 }
{ "type": "event", "id": "u-002", "kind": "freaking_out" }
{ "type": "state", "id": "u-002", "health": 0.20 }
{ "type": "event", "id": "u-002", "kind": "recovered" }  // back to calm
{ "type": "state", "id": "u-002", "health": 0.05 }
{ "type": "event", "id": "u-002", "kind": "died_defeated" }
```

### Resync after a network blip

```jsonc
// 1) New connection opens
// 2) Producer immediately sends:
{
  "type": "snapshot",
  "meeseeks": [
    { "id": "u-003", "health": 0.7,  "isFreakingOut": false, "name": "Mr. Meeseeks", "task": "tail logs" },
    { "id": "u-009", "health": 0.15, "isFreakingOut": true,  "task": "drain queue" }
  ]
}
// 3) Then resumes normal streaming
{ "type": "state", "id": "u-003", "health": 0.65 }
```

---

## Open questions for the producer team

The aquarium is interface-frozen; the answers below are entirely the
producer team's call. We'll wire whatever you settle on.

1. **WebSocket URL / TLS.** Will the aquarium connect to `wss://your-host/aquarium`,
   `ws://localhost:port/...`, both? Single URL for everyone, or per-tenant?
2. **Authentication.** Token via `?token=…` query param? Subprotocol header?
   Cookie? Unauthenticated for now?
3. **Heartbeat / ping.** Will the producer send ping frames? Expect pings
   from the aquarium? Or rely on the WebSocket-level `pong`?
4. **Reconnect cadence.** The aquarium will retry on disconnect — what's
   a reasonable backoff curve from your side (1 s, 2 s, 5 s, 30 s cap)?
5. **Tenant model.** One aquarium per producer instance, or can one
   aquarium be fed by multiple producers? (If multiple, IDs must be
   globally unique — flag if that's a problem.)
6. **Rate.** Realistic peak message rate from your side? We're sized for
   ~1 k/sec; if you'll routinely push more, we should talk about batching.
7. **Snapshot cost.** How heavy is computing a snapshot on your end? If
   it's expensive, we'll lean on incremental events more and snapshot only
   on explicit resync; if it's cheap, we can ask for one on every reconnect.
8. **`name` / `task` policy.** Stable identifiers (always set) or only on
   `born`? Localized strings, or canonical English?

Any other ambiguity, open an issue or ping us — easier to clarify in writing
once than rediscover six weeks later.
