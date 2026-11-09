// SPDX-License-Identifier: MPL-2.0
import { GameFiles } from '../src/files.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import {
  CHECKPOINT_LIMIT,
  serializeCheckpoint,
  deserializeCheckpoint,
} from '../src/checkpoint.mjs';
const $ = (id) => document.getElementById(id),
  canvas = $('screen'),
  actions = [];
let engine,
  running = false,
  lastTime = 0,
  accumulator = 0,
  statusTime = 0;
const fail = (error) => {
  $('error').hidden = false;
  $('error').textContent = error.message;
  $('diagnostics').textContent = `${error.stack}\n${JSON.stringify(engine?.status(), null, 2)}`;
  console.error(error);
};
const enqueue = (action) =>
  new Promise((resolve, reject) =>
    actions.push(async () => {
      try {
        resolve(await action());
      } catch (e) {
        fail(e);
        reject(e);
      }
    }),
  );
function updateStatus(state) {
  for (const id of ['next', 'quick-save']) $(id).disabled = !state.story;
  $('export').disabled = state.mode !== 'running';
  for (const id of ['quick-load', 'backlog', 'settings', 'import']) $(id).disabled = !engine;
  const now = performance.now();
  if (now - statusTime < 400) return;
  statusTime = now;
  $('status').textContent = state.message
    ? `${state.message.scene} · ${state.message.index + 1} · ${state.waiting || 'playing'}${state.audio === 'suspended' ? ' · sound is paused' : ''}`
    : state.stack.join(' → ') || state.mode;
  $('diagnostics').textContent = JSON.stringify({ ...state, vm: engine.vmEvidence }, null, 2);
}
async function launch(getGame) {
  if (running) {
    running = false;
    await engine?.dispose();
  }
  $('error').hidden = true;
  $('start').disabled = true;
  $('status').textContent = 'Loading game resources…';
  const audioContext = new AudioContext();
  await audioContext.resume();
  try {
    const game = await getGame();
    engine = new CatSystem2({
      game,
      canvas,
      audioContext,
      video: $('movie'),
      onState: updateStatus,
      onClosed: () => {
        running = false;
        $('welcome').hidden = false;
        $('start').disabled = false;
        $('status').textContent = 'Game closed';
      },
    });
    engine.onError = fail;
    globalThis.catSystem2 = engine;
    await engine.initialize();
    $('game-title').textContent = game.title.replace(/^\$[^$]+\$/, '');
    $('stage').style.aspectRatio = `${game.width} / ${game.height}`;
    $('welcome').hidden = true;
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    canvas.focus({ preventScroll: true });
    requestAnimationFrame(loop);
  } catch (e) {
    fail(e);
    $('start').disabled = false;
    await audioContext.close();
  }
}
function gamepad() {
  engine.inputBindings.gamepad(navigator.getGamepads());
}
async function loop(now) {
  if (!running) return;
  try {
    while (actions.length) await actions.shift()();
    gamepad();
    accumulator += Math.min(100, now - lastTime) * 0.06;
    lastTime = now;
    const count = Math.min(6, Math.floor(accumulator));
    accumulator -= count;
    if (count) await engine.step(count);
    await engine.render();
  } catch (e) {
    running = false;
    fail(e);
  }
  if (running) requestAnimationFrame(loop);
}
$('start').onclick = () => launch(() => GameFiles.fromHTTP('/game.json'));
$('open').onclick = () => $('folder').click();
$('folder').onchange = () => launch(() => GameFiles.fromFileList($('folder').files));
$('next').onclick = () => enqueue(() => engine.advance()).catch(() => {});
$('settings').onclick = () =>
  enqueue(() =>
    engine.world ? engine.world.window.post(0x46c, 0, 20) : engine.openModal('config'),
  ).catch(() => {});
$('backlog').onclick = () =>
  enqueue(() => engine.openModal(engine.theme?.value('log', 'script') || 'hist_b')).catch(() => {});
$('quick-save').onclick = () => enqueue(() => engine.host.systemAction(21)).catch(() => {});
$('quick-load').onclick = () =>
  enqueue(async () => {
    const slot = engine.saves.newest(engine.quickSaveStart, 12);
    if (slot < 0) throw new Error('No quick save yet');
    await engine.restore(engine.saves.get(slot).data);
  }).catch(() => {});
$('fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(fail);
  else $('stage').requestFullscreen().catch(fail);
};
document.addEventListener('fullscreenchange', () => engine?.nativeWindowStateChanged());
$('export').onclick = () =>
  enqueue(async () => {
    const data = await engine.snapshot(),
      url = URL.createObjectURL(
        new Blob([await serializeCheckpoint(data)], { type: 'application/octet-stream' }),
      );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catsystem2-save.cs2save';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch(() => {});
$('import').onclick = () => $('save-file').click();
$('save-file').onchange = () =>
  enqueue(async () => {
    const file = $('save-file').files[0];
    if (!file || file.size > CHECKPOINT_LIMIT)
      throw new Error('Save file exceeds checkpoint limit');
    await engine.restore(await deserializeCheckpoint(new Uint8Array(await file.arrayBuffer())));
  }).catch(() => {});
const point = (event) => {
  const r = canvas.getBoundingClientRect();
  return [
    ((event.clientX - r.left) * canvas.width) / r.width,
    ((event.clientY - r.top) * canvas.height) / r.height,
  ];
};
const nativeTouch = (event) =>
  event.pointerType === 'touch' && !!engine?.world.configuration.fields.application.touch;
canvas.addEventListener('pointermove', (event) => {
  if (!engine || !running) return;
  const position = point(event),
    touch = nativeTouch(event);
  enqueue(() =>
    touch ? engine.touchContact(event.pointerId, ...position, 'move') : engine.hover(...position),
  ).catch(() => {});
});
canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType !== 'mouse') return;
  if (engine && running) enqueue(() => engine.hover(null, null)).catch(() => {});
});
canvas.addEventListener('pointerdown', (event) => {
  // The browser can scroll when focus moves from the toolbar to the canvas.
  // Sample the event against its current geometry, before focus or the next RAF.
  const position = point(event);
  canvas.focus({ preventScroll: true });
  if (!engine || !running) return;
  const touch = nativeTouch(event);
  canvas.setPointerCapture(event.pointerId);
  enqueue(() =>
    touch
      ? engine.touchContact(event.pointerId, ...position, 'down')
      : engine.pointerButton(...position, event.button, true),
  ).catch(() => {});
});
canvas.addEventListener('pointerup', (event) => {
  if (!engine || !running) return;
  const position = point(event),
    touch = nativeTouch(event);
  enqueue(() => {
    if (touch) engine.touchContact(event.pointerId, ...position, 'up');
    else engine.pointerButton(...position, event.button, false);
  }).catch(() => {});
});
canvas.addEventListener('pointercancel', (event) => {
  if (!engine || !running) return;
  enqueue(() =>
    nativeTouch(event)
      ? engine.touchContact(event.pointerId, ...point(event), 'up')
      : engine.inputBindings.releasePointer(),
  ).catch(() => {});
});
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!engine || !running) return;
    event.preventDefault();
    enqueue(() => engine.inputBindings.wheel(event.deltaY < 0)).catch(() => {});
  },
  { passive: false },
);
document.addEventListener('keydown', (event) => {
  if (!engine || !running || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (engine.inputBindings.acceptsKeyboard(event)) {
    event.preventDefault();
    enqueue(async () => {
      await engine.audio.unlock();
      engine.inputBindings.keyboard(event, true);
    }).catch(() => {});
  }
});
document.addEventListener('keyup', (event) => {
  if (engine && running) enqueue(() => engine.inputBindings.keyboard(event, false)).catch(() => {});
});
window.addEventListener('blur', () => {
  engine?.inputBindings?.releaseAll();
});
window.addEventListener('pagehide', () => {
  running = false;
  engine?.dispose().catch(() => {});
});
