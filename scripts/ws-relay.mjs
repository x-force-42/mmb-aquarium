/**
 * Tiny WS broadcast relay.
 *
 * The browser can't host a WebSocket server, so this Node process bridges
 * the MMB producer (the team's spec assumes it pushes to ws://localhost:8080/ws)
 * to the browser-side aquarium. State-less and transparent: each frame
 * received from any client is forwarded byte-for-byte to every OTHER open
 * client. Nothing is parsed, validated, buffered, or cached.
 *
 * Run with `npm run relay`. Port is overridable via PORT env var.
 */

import { WebSocketServer } from 'ws';

// Default to 0.0.0.0 so producers running in WSL / Docker / another VM can
// reach the relay on the host's IP. From within those environments `127.0.0.1`
// is the *container's* loopback — not the host's — which manifests as
// ECONNREFUSED before any handshake. Lock it back to '127.0.0.1' via
// RELAY_HOST when you really want loopback-only.
const HOST = process.env.RELAY_HOST ?? '0.0.0.0';
const PATH = '/ws';
const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);

const wss = new WebSocketServer({ host: HOST, port: PORT, path: PATH });

wss.on('listening', () => {
  console.log(`relay: listening on ws://${HOST}:${PORT}${PATH}`);
});

wss.on('error', (err) => {
  console.warn('relay: server error:', err);
});

wss.on('connection', (socket, req) => {
  const peer = `${req.socket.remoteAddress ?? '?'}:${req.socket.remotePort ?? '?'}`;
  console.log(`relay: connect ${peer} (peers=${wss.clients.size})`);

  socket.on('message', (data, isBinary) => {
    for (const client of wss.clients) {
      if (client === socket) continue;
      if (client.readyState !== client.OPEN) continue;
      client.send(data, { binary: isBinary });
    }
  });

  socket.on('error', (err) => {
    console.warn(`relay: client ${peer} error:`, err);
  });

  socket.on('close', () => {
    console.log(`relay: disconnect ${peer} (peers=${wss.clients.size})`);
  });
});

function shutdown(signal) {
  console.log(`relay: ${signal} received, shutting down`);
  for (const client of wss.clients) {
    try {
      client.terminate();
    } catch (err) {
      console.warn('relay: terminate failed:', err);
    }
  }
  wss.close(() => process.exit(0));
  // Safety net: if close() never settles (e.g. lingering handles), force-exit.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
