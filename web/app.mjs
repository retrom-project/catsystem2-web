// SPDX-License-Identifier: MPL-2.0
import { GameFiles } from '../src/files.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { CatSystem2 } from '../src/engine.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const $ = (id) => document.getElementById(id),
  canvas = $('screen'),
  frameRate = $('frame-rate'),
  actions = [];
let engine,
  running = false,
  clockWorld,
  lastTime = 0,
  accumulator = 0,
  statusTime = 0;
let meterWorld, restorePresent, presentedFrame, frameSample;

function resetFrameRate() {
  if (!frameSample) return;
  clearInterval(frameSample.timer);
  frameSample = undefined;
  frameRate.hidden = true;
}

function monitorPresentation(world) {
  if (meterWorld === world) return;
  restorePresent?.();
  restorePresent = undefined;
  resetFrameRate();
  meterWorld = world;
  if (!world) return;
  const stage = world.stageRenderer,
    present = stage.presentNative,
    own = Object.hasOwn(stage, 'presentNative');
  const observed = function (request) {
    const status = present.call(this, request);
    if (request.stageTarget && status === 0) presentedFrame = world.frame;
    return status;
  };
  stage.presentNative = observed;
  restorePresent = () => {
    if (stage.presentNative !== observed) return;
    if (own) stage.presentNative = present;
    else delete stage.presentNative;
  };
}

function countPresentedFrame() {
  if (presentedFrame === undefined || document.hidden) {
    resetFrameRate();
    return;
  }
  if (!frameSample) {
    const sample = { startedAt: performance.now(), frame: presentedFrame, completed: 0 };
    sample.timer = setInterval(() => {
      const now = performance.now(),
        label = `${Math.round((sample.completed * 1000) / (now - sample.startedAt))} FPS`;
      if (frameRate.textContent !== label) frameRate.textContent = label;
      sample.completed = 0;
      sample.startedAt = now;
    }, 500);
    frameSample = sample;
    frameRate.textContent = '— FPS';
    frameRate.hidden = false;
  } else if (presentedFrame !== frameSample.frame) {
    frameSample.completed++;
    frameSample.frame = presentedFrame;
  }
}

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
  $('system-settings').disabled = state.mode !== 'running' || !engine?.world || !running;
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
  monitorPresentation(undefined);
  if (running) {
    running = false;
    await engine?.dispose();
  }
  $('error').hidden = true;
  $('language-controls').hidden = true;
  $('start').disabled = true;
  $('system-settings').disabled = true;
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
        monitorPresentation(undefined);
        $('welcome').hidden = false;
        $('start').disabled = false;
        $('system-settings').disabled = true;
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
    clockWorld = engine.world;
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
function resetClockForWorld(world) {
  if (clockWorld === world) return;
  clockWorld = world;
  lastTime = undefined;
  accumulator = 0;
}
async function loop(now) {
  if (!running) return;
  try {
    while (actions.length) await actions.shift()();
    gamepad();
    const current = engine;
    // The RAF that awaited a restore predates the restored World's playback.
    resetClockForWorld(current.world);
    if (lastTime !== undefined && now > lastTime) {
      accumulator += Math.min(100, now - lastTime) * 0.06;
      lastTime = now;
    }
    const count = Math.min(6, Math.floor(accumulator));
    accumulator -= count;
    if (count) await engine.step(count);
    const world = current.world;
    resetClockForWorld(world);
    if (running) monitorPresentation(world);
    presentedFrame = undefined;
    await engine.render();
    if (running && engine === current && current.world === world) {
      lastTime ??= performance.now();
      countPresentedFrame();
    }
  } catch (e) {
    running = false;
    monitorPresentation(undefined);
    $('system-settings').disabled = true;
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
$('system-settings').onclick = () => {
  const world = engine?.world;
  if (!running || !world || world.closed || world.disposalRequested) return;
  $('system-settings').disabled = true;
  canvas.focus({ preventScroll: true });
  enqueue(() => {
    if (world === engine.world) world.window.post(0x46c, 0, 21);
  }).catch(() => {});
};
$('backlog').onclick = () =>
  enqueue(() =>
    engine.world
      ? engine.host.systemAction(15)
      : engine.openModal(engine.theme?.value('log', 'script') || 'hist_b'),
  ).catch(() => {});
$('quick-save').onclick = () => enqueue(() => engine.host.quickSave()).catch(() => {});
$('quick-load').onclick = () =>
  enqueue(() => {
    resetFrameRate();
    return engine.host.quickLoad();
  }).catch(() => {});
for (const id of ['fullscreen', 'exit-fullscreen']) {
  const control = $(id);
  control.addEventListener('keydown', (event) => event.stopPropagation());
  control.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('stage').requestFullscreen();
      const focus = document.fullscreenElement || running ? canvas : $('fullscreen');
      focus.focus({ preventScroll: true });
    } catch (error) {
      fail(error);
    }
  };
}
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
    resetFrameRate();
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
document.addEventListener('visibilitychange', resetFrameRate);
window.addEventListener('pagehide', () => {
  running = false;
  monitorPresentation(undefined);
  engine?.dispose().catch(() => {});
});
