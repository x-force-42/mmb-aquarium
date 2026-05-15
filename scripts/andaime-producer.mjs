/**
 * Andaime producer — reflects the MMB scaffolding state into the aquarium.
 *
 * Reads four FS-backed surfaces from /MMB/.tooling/:
 *   - state/agents.jsonl       (append-only spawn/deregister events)
 *   - state/heartbeats/*.alive (mtime indicates liveness)
 *   - logs/journal.jsonl       (warn/error/critical events + resolutions)
 *   - inbox/<agent>/           (not yet consumed; v2 will visualize message flow)
 *
 * Translates them into `AppMessage`s compatible with the aquarium's existing
 * wire protocol (snapshot | state | event) — zero new message types. The
 * Morty / Meeseeks distinction is conveyed via the optional `kind` field on
 * snapshot entries and `entityKind` on `born` events.
 *
 * Connects to the local relay (ws://localhost:8080/ws by default) and pushes
 * frames; the relay broadcasts byte-for-byte to every other connected client
 * (including the browser running the aquarium).
 *
 * Wire mapping (andaime -> AppMessage):
 *
 *   spawn id=master              -> event:born  kind:morty,    name:master,   task:master
 *   spawn id=<orq>               -> event:born  kind:morty,    name:<orq>,    task:<parent>
 *   spawn id=<repo>-<task>       -> event:born  kind:meeseeks, name:<id>,     task:<task>
 *   deregister                   -> event:died_happy
 *   heartbeat age 0   .. 50% T   -> state:health=1.00
 *   heartbeat age 50% .. 80% T   -> state:health=0.50
 *   heartbeat age  > 80% T       -> state:health=0.20
 *   journal sev=error|critical   -> event:freaking_out (for the agent)
 *   journal event=resolved       -> event:recovered (for the agent in `resolves`'s record)
 *
 * Idempotency: born/state are dedup'd against an in-memory mirror of the
 * world. The aquarium itself also dedups born; this layer just avoids spam.
 *
 * Run with `npm run andaime:producer`. Env knobs:
 *   MMB_ROOT                  default /home/eliezer/llab/MMB
 *   RELAY_URL                 default ws://localhost:8080/ws
 *   ANDAIME_TICK_MS           default 500
 *   MMB_HEARTBEAT_TIMEOUT     default 600 (seconds; mirrors andaime config)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const MMB_ROOT = process.env.MMB_ROOT ?? '/home/eliezer/llab/MMB';
const RELAY_URL = process.env.RELAY_URL ?? 'ws://localhost:8080/ws';
const TICK_MS = Number.parseInt(process.env.ANDAIME_TICK_MS ?? '500', 10);
const HEARTBEAT_TIMEOUT_S = Number.parseInt(process.env.MMB_HEARTBEAT_TIMEOUT ?? '600', 10);

const AGENTS_PATH = join(MMB_ROOT, '.tooling', 'state', 'agents.jsonl');
const HEARTBEATS_DIR = join(MMB_ROOT, '.tooling', 'state', 'heartbeats');
const JOURNAL_PATH = join(MMB_ROOT, '.tooling', 'logs', 'journal.jsonl');

const ORQ_IDS = new Set(['master', 'core', 'cockpit', 'aquarium']);

// ── WebSocket connection management ──────────────────────────────────────────

let ws = null;
let wsReady = false;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
let reconnectAttempt = 0;

function connect() {
  console.log(`producer: connecting to ${RELAY_URL}...`);
  ws = new WebSocket(RELAY_URL);

  ws.on('open', () => {
    console.log(`producer: connected. Streaming andaime state from ${MMB_ROOT}`);
    wsReady = true;
    reconnectAttempt = 0;
    // Reset in-memory mirror so a fresh `snapshot` is sent on the next tick.
    state.alive.clear();
    state.healthByAgent.clear();
    state.freakingByAgent.clear();
    state.sentInitialSnapshot = false;
  });

  ws.on('close', () => {
    console.warn('producer: ws closed, will reconnect');
    wsReady = false;
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.warn(`producer: ws error: ${err.message}`);
    // 'close' follows; reconnect is handled there.
  });
}

function scheduleReconnect() {
  const idx = Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
  const delay = RECONNECT_DELAYS_MS[idx];
  reconnectAttempt += 1;
  setTimeout(connect, delay);
}

function send(msg) {
  if (!wsReady || !ws) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.warn(`producer: send failed: ${err.message}`);
  }
}

// ── In-memory mirror of the aquarium's world ─────────────────────────────────

const state = {
  // agent-id -> { kind, name, task }
  alive: new Map(),
  // agent-id -> last health bucket (0.2 | 0.5 | 1.0)
  healthByAgent: new Map(),
  // agent-id -> isFreakingOut
  freakingByAgent: new Map(),
  // journal-event-id -> agent (so resolutions can find the original target)
  freakOriginById: new Map(),
  // Resolved event ids (so we don't re-trigger freak after a resolution)
  resolvedIds: new Set(),
  sentInitialSnapshot: false,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function isOrq(id) {
  return ORQ_IDS.has(id);
}

function entityKindFor(id) {
  return isOrq(id) ? 'morty' : 'meeseeks';
}

/** Reduce the agents.jsonl to a map agent-id -> "spawn" record (or absent). */
function readAgentsAlive() {
  if (!existsSync(AGENTS_PATH)) return new Map();
  const text = readFileSync(AGENTS_PATH, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const last = new Map(); // id -> raw line object
  for (const line of lines) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof evt.id !== 'string') continue;
    last.set(evt.id, evt);
  }
  const alive = new Map();
  for (const [id, evt] of last) {
    if (evt.ev === 'spawn') alive.set(id, evt);
  }
  return alive;
}

/** Return heartbeat age in seconds, or null if no heartbeat file. */
function heartbeatAgeS(id) {
  const path = join(HEARTBEATS_DIR, `${id}.alive`);
  if (!existsSync(path)) return null;
  try {
    const mt = statSync(path).mtimeMs;
    return Math.max(0, (Date.now() - mt) / 1000);
  } catch {
    return null;
  }
}

/** Quantize heartbeat age into a coarse health bucket. */
function healthForAge(ageS) {
  if (ageS === null) return 0.2; // no heartbeat at all
  const t = HEARTBEAT_TIMEOUT_S;
  if (ageS < 0.5 * t) return 1.0;
  if (ageS < 0.8 * t) return 0.5;
  return 0.2;
}

/** Reads the journal, returns the list of events (parsed). */
function readJournal() {
  if (!existsSync(JOURNAL_PATH)) return [];
  const text = readFileSync(JOURNAL_PATH, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return out;
}

// ── Frame builders ───────────────────────────────────────────────────────────

function buildSnapshot(alive) {
  const meeseeks = [];
  for (const [id, rec] of alive) {
    const kind = entityKindFor(id);
    const ageS = heartbeatAgeS(id);
    const health = healthForAge(ageS);
    const entry = { id, kind, health };
    if (rec.task) entry.task = String(rec.task);
    // Use the agent-id as the displayed name; falls back gracefully if rec.name
    // is something else later.
    entry.name = id;
    meeseeks.push(entry);
  }
  return { type: 'snapshot', meeseeks };
}

function buildBorn(id, rec) {
  const msg = {
    type: 'event',
    id,
    kind: 'born',
    name: id,
    entityKind: entityKindFor(id),
  };
  if (rec.task) msg.task = String(rec.task);
  return msg;
}

function buildDied(id) {
  return { type: 'event', id, kind: 'died_happy' };
}

function buildHealth(id, health) {
  return { type: 'state', id, health };
}

function buildFreak(id) {
  return { type: 'event', id, kind: 'freaking_out' };
}

function buildRecovered(id) {
  return { type: 'event', id, kind: 'recovered' };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

function tick() {
  if (!wsReady) return;

  const aliveNow = readAgentsAlive();
  const journal = readJournal();

  // First tick after (re)connect: emit a snapshot, then track diffs from now on.
  if (!state.sentInitialSnapshot) {
    send(buildSnapshot(aliveNow));
    state.alive = new Map(aliveNow);
    state.healthByAgent.clear();
    state.freakingByAgent.clear();
    for (const id of aliveNow.keys()) {
      state.healthByAgent.set(id, healthForAge(heartbeatAgeS(id)));
    }
    // Replay journal up to now to set freaking state correctly.
    applyJournal(journal, /*emitDiff*/ false);
    state.sentInitialSnapshot = true;
    return;
  }

  // Spawn diffs: anyone in aliveNow not in state.alive -> born.
  for (const [id, rec] of aliveNow) {
    if (!state.alive.has(id)) {
      send(buildBorn(id, rec));
      state.alive.set(id, rec);
      state.healthByAgent.set(id, healthForAge(heartbeatAgeS(id)));
    }
  }
  // Deregister diffs: anyone gone from state.alive -> died_happy.
  for (const id of state.alive.keys()) {
    if (!aliveNow.has(id)) {
      send(buildDied(id));
      state.alive.delete(id);
      state.healthByAgent.delete(id);
      state.freakingByAgent.delete(id);
    }
  }

  // Health diffs: re-evaluate per agent.
  for (const id of state.alive.keys()) {
    const next = healthForAge(heartbeatAgeS(id));
    const prev = state.healthByAgent.get(id);
    if (next !== prev) {
      send(buildHealth(id, next));
      state.healthByAgent.set(id, next);
    }
  }

  // Journal diffs: only events not yet processed lead to freak/recover.
  applyJournal(journal, /*emitDiff*/ true);
}

/**
 * Walks the journal. When `emitDiff` is true, sends freak/recovered events
 * only for transitions not already reflected in `freakingByAgent`.
 */
function applyJournal(journal, emitDiff) {
  // First pass: collect resolved ids (any event with `resolves` clears it).
  for (const evt of journal) {
    if (typeof evt.resolves === 'string') {
      state.resolvedIds.add(evt.resolves);
    }
  }

  // Second pass: for each unresolved error/critical, target the agent.
  for (const evt of journal) {
    const id = typeof evt.id === 'string' ? evt.id : null;
    const agent = typeof evt.agent === 'string' ? evt.agent : null;
    const sev = typeof evt.sev === 'string' ? evt.sev : null;
    if (!id || !agent || (sev !== 'error' && sev !== 'critical')) continue;
    if (state.resolvedIds.has(id)) continue;
    // Skip if the agent isn't currently alive in our mirror — nothing to render.
    if (!state.alive.has(agent)) continue;
    state.freakOriginById.set(id, agent);
    const wasFreaking = state.freakingByAgent.get(agent) === true;
    if (!wasFreaking) {
      state.freakingByAgent.set(agent, true);
      if (emitDiff) send(buildFreak(agent));
    }
  }

  // Third pass: resolutions -> recovered, if the agent was freaking.
  for (const evt of journal) {
    if (typeof evt.resolves !== 'string') continue;
    const origin = state.freakOriginById.get(evt.resolves);
    if (!origin) continue;
    if (!state.alive.has(origin)) continue;
    // Only emit recovered if no other unresolved error still targets `origin`.
    const stillFreaking = anyUnresolvedFor(journal, origin);
    if (stillFreaking) continue;
    if (state.freakingByAgent.get(origin)) {
      state.freakingByAgent.set(origin, false);
      if (emitDiff) send(buildRecovered(origin));
    }
  }
}

function anyUnresolvedFor(journal, agent) {
  for (const evt of journal) {
    if (evt.agent !== agent) continue;
    if (evt.sev !== 'error' && evt.sev !== 'critical') continue;
    if (typeof evt.id !== 'string') continue;
    if (state.resolvedIds.has(evt.id)) continue;
    return true;
  }
  return false;
}

// ── Optional one-shot diagnostic (`--once`) ──────────────────────────────────
// Useful in tests / manual runs: print the snapshot that would be sent and exit.

const ARG_ONCE = process.argv.includes('--once');
if (ARG_ONCE) {
  const alive = readAgentsAlive();
  const snap = buildSnapshot(alive);
  process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
  process.exit(0);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

console.log(`producer: MMB_ROOT=${MMB_ROOT}`);
console.log(`producer: HEARTBEAT_TIMEOUT_S=${HEARTBEAT_TIMEOUT_S}, TICK_MS=${TICK_MS}`);
console.log(`producer: heartbeat dir is ${existsSync(HEARTBEATS_DIR) ? 'present' : 'MISSING'}`);
connect();
setInterval(tick, TICK_MS);

function shutdown(signal) {
  console.log(`producer: ${signal} received, shutting down`);
  try {
    ws?.close();
  } catch {
    // ignore
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
