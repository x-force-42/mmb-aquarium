/**
 * main.ts — composition root.
 *
 * The ONLY place that knows the concrete identities of Transport / World /
 * Renderer / AudioSystem. Swap SimulatorTransport for WebSocketTransport here
 * without touching any other file.
 *
 *   Transport  --messages-->  World  --events-->  { Renderer, AudioSystem }
 */

import { Renderer } from './renderer';
import { SimulatorTransport } from './transport';
import { World } from './world';
import { AudioSystem, type AudioPublicHook } from './audio';
import { parseAudioConfig } from './audio-config';

declare global {
  interface Window {
    /** Test hook (Playwright). Not part of the public API. */
    __aquarium?: {
      world: World;
      renderer: Renderer;
      sim: SimulatorTransport;
      audio: AudioPublicHook;
    };
  }
}

function boot(): void {
  const container = document.getElementById('pixi-container');
  if (!container) throw new Error('main.ts: missing #pixi-container');

  const world = new World();
  const renderer = new Renderer(container);
  renderer.bind(world);

  const audioConfig = parseAudioConfig(
    import.meta.env as unknown as Record<string, string | undefined>,
  );
  const audio = new AudioSystem(audioConfig, {
    panOf: (id) => renderer.spritePanX(id),
  });
  audio.bind(world);
  // Fire-and-forget: buffers stream in async; events fired before they land
  // simply don't make sound. Default-muted means there's no audible window
  // of "no audio yet" anyway.
  void audio.load();

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

  // Mute toggle. Click is also the user gesture that resumes the AudioContext.
  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    const refreshMute = (): void => {
      const muted = audio.isMuted();
      muteBtn.textContent = muted ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-label', muted ? 'Ativar som' : 'Silenciar');
      muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    };
    muteBtn.addEventListener('click', () => {
      audio.setMuted(!audio.isMuted());
      refreshMute();
    });
    refreshMute();
  }

  // Stable handle for e2e tests / devtools poking.
  window.__aquarium = { world, renderer, sim, audio };
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
