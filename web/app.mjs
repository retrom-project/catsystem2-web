// SPDX-License-Identifier: MPL-2.0
import { GameFiles } from '../src/files.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
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
  $('diagnostics').textContent = `${error.stack}\n${JSON.stringify(
    {
      ...engine?.status(),
      failure: { details: error.details, kcs: error.kcs, nativeFault: error.nativeFault },
    },
    null,
    2,
  )}`;
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
function updateLanguageControls(current = engine) {
  if (current !== engine) return;
  const world = current?.world,
    language = world?.configuration.language,
    visible = Boolean(
      world &&
        nativeABI(world.profile).capabilities.windowLanguageAccelerators &&
        !world.closed &&
        !world.disposalRequested &&
        language?.entries.length,
    );
  $('language-controls').hidden = !visible;
  if (!visible) return;
  for (const [group, field] of ['ui', 'main', 'sub'].entries()) {
    const select = $(`language-${field}`),
      choices = language.entries.slice(0, 10).map((entry, index) => ({
        value: index,
        name: entry.lang || entry.prefix,
        command: 40065 + group * 10 + index,
      }));
    if (field === 'sub')
      choices.push({
        value: 0xffffffff,
        name: 'None',
        command: language.entries.length < 10 ? 40085 + language.entries.length : null,
      });
    select.replaceChildren(
      ...choices.map(({ value, name, command }) => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = name;
        if (command !== null) option.dataset.command = String(command);
        option.disabled = command === null || world.menu.get(command) === false;
        return option;
      }),
    );
    select.value = String(language[field] >>> 0);
  }
}
function updateStatus(state) {
  const nativeReady = Boolean(
    engine?.world && state.mode === 'running' && engine.activeFES()?.root,
  );
  for (const id of ['next', 'quick-save']) $(id).disabled = !state.story && !nativeReady;
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
  $('language-controls').hidden = true;
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
        updateLanguageControls();
      },
    });
    const current = engine,
      languageMenuChanged = (command) => {
        if (command >= 40065 && command <= 40094) updateLanguageControls(current);
      };
    current.onNativeMenuChanged = languageMenuChanged;
    current.onNativeMenuChecked = languageMenuChanged;
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
    $('language-controls').hidden = true;
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
for (const field of ['ui', 'main', 'sub'])
  $(`language-${field}`).onchange = () => {
    const current = engine,
      world = current?.world,
      option = $(`language-${field}`).selectedOptions[0];
    if (!running || !world || option?.disabled || !option?.dataset.command) return;
    const command = Number(option.dataset.command);
    enqueue(() => {
      if (engine !== current || current.world !== world || world.closed || world.disposalRequested)
        return updateLanguageControls();
      world.window.post(0x111, command);
    }).catch(() => {});
  };
$('next').onclick = () => enqueue(() => engine.advance()).catch(() => {});
$('settings').onclick = () =>
  enqueue(() => (engine.world ? engine.host.systemAction(23) : engine.openModal('config'))).catch(
    () => {},
  );
$('backlog').onclick = () =>
  enqueue(() =>
    engine.world
      ? engine.host.systemAction(15)
      : engine.openModal(engine.theme?.value('log', 'script') || 'hist_b'),
  ).catch(() => {});
$('quick-save').onclick = () => enqueue(() => engine.host.quickSave()).catch(() => {});
$('quick-load').onclick = () => enqueue(() => engine.host.quickLoad()).catch(() => {});
$('fullscreen').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(fail);
  else $('stage').requestFullscreen().catch(fail);
};
document.addEventListener('fullscreenchange', () => engine?.nativeWindowStateChanged());
$('export').onclick = () =>
  enqueue(async () => {
    const data = await engine.snapshot(),
      url = URL.createObjectURL(
        new Blob([await serializeCheckpoint(data, engine.checkpointLimit)], {
          type: 'application/octet-stream',
        }),
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
    if (!file || file.size > engine.checkpointLimit)
      throw new Error('Save file exceeds checkpoint limit');
    await engine.restore(
      await deserializeCheckpoint(new Uint8Array(await file.arrayBuffer()), engine.checkpointLimit),
    );
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
  if (
    !engine ||
    !running ||
    event.defaultPrevented ||
    event.target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
  )
    return;
  const current = engine,
    shortcut = current.world?.window.keyboardShortcut(event);
  if (!shortcut && !current.inputBindings.acceptsKeyboard(event)) return;
  event.preventDefault();
  enqueue(async () => {
    if (engine !== current || !running) return;
    await current.audio.unlock();
    if (shortcut) current.world?.window.post(...shortcut);
    else current.inputBindings.keyboard(event, true);
  }).catch(() => {});
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
