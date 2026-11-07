// SPDX-License-Identifier: MPL-2.0
import { GameFiles } from '../src/files.mjs';
import { CatSystem2 } from '../src/engine.mjs';
const $ = (id) => document.getElementById(id),
  canvas = $('screen'),
  actions = [];
let engine,
  running = false,
  lastTime = 0,
  accumulator = 0,
  statusTime = 0,
  padState = {},
  padRepeat = 0;
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
  for (const id of ['next', 'quick-save', 'export']) $(id).disabled = !state.story;
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
    canvas.focus();
    requestAnimationFrame(loop);
  } catch (e) {
    fail(e);
    $('start').disabled = false;
    await audioContext.close();
  }
}
function gamepad(now) {
  const pad = [...navigator.getGamepads()].find(Boolean);
  if (!pad) {
    padState = {};
    return;
  }
  const buttons = {
    confirm: !!pad.buttons[0]?.pressed,
    cancel: !!pad.buttons[1]?.pressed,
    up: !!pad.buttons[12]?.pressed || pad.axes[1] < -0.5,
    down: !!pad.buttons[13]?.pressed || pad.axes[1] > 0.5,
    left: !!pad.buttons[14]?.pressed || pad.axes[0] < -0.5,
    right: !!pad.buttons[15]?.pressed || pad.axes[0] > 0.5,
  };
  for (const direction of ['up', 'down', 'left', 'right'])
    if (buttons[direction] && (!padState[direction] || now > padRepeat)) {
      engine.activeFES()?.moveFocus(direction);
      padRepeat = now + 180;
    }
  if (buttons.confirm && !padState.confirm) engine.confirm();
  if (buttons.cancel && !padState.cancel) engine.cancel();
  padState = buttons;
}
async function loop(now) {
  if (!running) return;
  try {
    while (actions.length) await actions.shift()();
    gamepad(now);
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
    engine.story ? engine.openModal('config') : engine.activeFES()?.root?.startChild('config'),
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
$('export').onclick = () =>
  enqueue(async () => {
    const data = await engine.snapshot(),
      url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'catsystem2-save.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch(() => {});
$('import').onclick = () => $('save-file').click();
$('save-file').onchange = () =>
  enqueue(async () => {
    const file = $('save-file').files[0];
    if (!file || file.size > 16 * 1024 * 1024) throw new Error('Save file exceeds 16 MiB');
    await engine.restore(JSON.parse(await file.text()));
  }).catch(() => {});
const point = (event) => {
  const r = canvas.getBoundingClientRect();
  return [
    ((event.clientX - r.left) * canvas.width) / r.width,
    ((event.clientY - r.top) * canvas.height) / r.height,
  ];
};
canvas.addEventListener('pointermove', (event) => {
  if (engine && running) enqueue(() => engine.hover(...point(event))).catch(() => {});
});
canvas.addEventListener('pointerleave', () => {
  if (engine && running) enqueue(() => engine.hover(null, null)).catch(() => {});
});
canvas.addEventListener('pointerdown', (event) => {
  canvas.focus();
  if (!engine || !running || event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  enqueue(() => engine.beginDrag(...point(event))).catch(() => {});
});
canvas.addEventListener('pointerup', (event) => {
  if (!engine || !running || event.button !== 0) return;
  enqueue(() => {
    if (!engine.dragging) engine.click(...point(event));
    engine.endDrag();
    if (event.pointerType !== 'mouse') engine.hover(null, null);
  }).catch(() => {});
});
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (engine && running) enqueue(() => engine.cancel()).catch(() => {});
});
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!engine || !running) return;
    event.preventDefault();
    enqueue(() => engine.activeFES()?.scroll(event.deltaY < 0)).catch(() => {});
  },
  { passive: false },
);
document.addEventListener('keydown', (event) => {
  if (!engine || !running || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (
    ['Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Control'].includes(
      event.key,
    )
  ) {
    event.preventDefault();
    enqueue(async () => {
      await engine.audio.unlock();
      if (event.key === 'Enter' || event.key === ' ') engine.confirm();
      else if (event.key === 'Escape') engine.cancel();
      else if (event.key === 'Control') engine.skip = true;
      else engine.activeFES()?.moveFocus(event.key.slice(5).toLowerCase());
    }).catch(() => {});
  }
});
document.addEventListener('keyup', (event) => {
  if (event.key === 'Control' && engine) engine.skip = false;
});
window.addEventListener('blur', () => {
  if (engine) engine.skip = false;
  padState = {};
});
window.addEventListener('pagehide', () => {
  running = false;
  engine?.dispose().catch(() => {});
});
