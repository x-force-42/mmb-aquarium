/**
 * main.ts — composition root.
 *
 * The ONLY place that knows the concrete identities of Transport / World /
 * Renderer. Swap SimulatorTransport for WebSocketTransport here without
 * touching any other file.
 *
 *   Transport  --messages-->  World  --events-->  Renderer
 */

import { Renderer } from './renderer';
import { SimulatorTransport } from './transport';
import { World } from './world';

declare global {
  interface Window {
    /** Test hook (Playwright). Not part of the public API. */
    __aquarium?: {
      world: World;
      renderer: Renderer;
      sim: SimulatorTransport;
    };
  }
}

function boot(): void {
  const container = document.getElementById('pixi-container');
  if (!container) throw new Error('main.ts: missing #pixi-container');

  const world = new World();
  const renderer = new Renderer(container);
  renderer.bind(world);

  const sim = new SimulatorTransport(world);
  sim.onMessage((msg) => world.handleMessage(msg));
  sim.bindButtons({
    born: 'btn-born',
    diedHappy: 'btn-died-happy',
    diedDefeated: 'btn-died-defeated',
    freakingOut: 'btn-freaking-out',
    recovered: 'btn-recovered',
    decay: 'btn-decay',
  });

  // Header counter — minor UX nicety, not part of the core architecture.
  const counterEl = document.getElementById('counter');
  if (counterEl) {
    const refresh = (): void => {
      const n = world.size();
      counterEl.textContent = `${n} vivo${n === 1 ? '' : 's'}`;
    };
    world.on('onBorn', refresh);
    world.on('onDiedHappy', refresh);
    world.on('onDiedDefeated', refresh);
    refresh();
  }

  // Stable handle for e2e tests / devtools poking.
  window.__aquarium = { world, renderer, sim };
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
