// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { CatSystem2 } from '../src/engine.mjs';
import { audioFixture } from './fixtures/audio-context.mjs';
import {
  ordinaryStartupGame,
  StartupCanvas,
  startupEnvironment,
} from './fixtures/ordinary-startup.mjs';
import { kcsProgram, kif } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
class FrameCanvas extends StartupCanvas {
  getContext(type) {
    const context = super.getContext(type);
    if (type === 'webgl2') {
      if (!Object.hasOwn(context, 'isEnabled')) {
        const enabled = new Set();
        Object.assign(context, {
          NO_ERROR: 0,
          enable: (value) => enabled.add(value),
          disable: (value) => enabled.delete(value),
          isEnabled: (value) => enabled.has(value),
          getError: () => 0,
        });
      }
      if (!Object.hasOwn(context, 'drawingBufferWidth'))
        Object.defineProperties(context, {
          drawingBufferWidth: { get: () => this.width },
          drawingBufferHeight: { get: () => this.height },
        });
      // Standard host leaves for command-order tests, not a raster/pixel oracle.
      for (const name of [
        'colorMask',
        'depthMask',
        'stencilMask',
        'disable',
        'clearDepth',
        'clearStencil',
        'clearColor',
        'clear',
        'drawArrays',
        'drawElements',
        'blitFramebuffer',
      ])
        if (!Object.hasOwn(context, name)) context[name] = () => {};
    }
    if (type === '2d' && !context.setTransform)
      Object.assign(context, {
        setTransform() {},
        reset() {},
        clearRect() {},
        fillRect() {},
        putImageData() {},
        drawImage: () => this.onPresent?.(),
      });
    return context;
  }
}

async function core(now) {
  const program = kcsProgram([
      [43, 5, 0],
      [38, 4],
      [43, 65, 0],
      [43, 5, 0],
      [38, 8],
      [43, 65, 0],
      [59],
    ]),
    game = await ordinaryStartupGame(profile, {
      sound: false,
      files: { 'scripts.int': kif([['main.kcs', program]]) },
    }),
    { context } = audioFixture();
  const player = new CatSystem2({
    game,
    canvas: new FrameCanvas(),
    audioContext: context,
    nativeProfile: profile,
    randomSeed: 3,
    uiLanguage: 0x411,
    prepareSceneWorkers: false,
    frameSource: { now },
  });
  await player.initialize();
  return player;
}

test('actual Core construction keeps six time units in one dispatch and completes after present', async () => {
  const environment = startupEnvironment();
  let player,
    timer = 0,
    presentations = 0;
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      configurable: true,
      value: FrameCanvas,
    });
    player = await core(() => timer);
    assert.equal(player.world.frame, 0);
    const wait = player.beginFrameWait();
    timer = 100;
    const sample = player.frameWaitTime(wait);
    timer = 117; // Work after the callback must not move its observed bucket.
    await player.step(6, wait, sample);
    assert.equal(player.world.frame, 6);
    assert.equal(player.world.clock.now(), 117);
    assert.equal(player.world.main.machine.load(4), 6);
    assert.equal(player.world.main.machine.load(8), 0);
    assert.equal(player.world.framePacer.pendingStep, 0);
    player.canvas.onPresent = () => {
      presentations++;
      assert.equal(player.world.framePacer.pendingStep, 0);
    };
    await player.render();
    assert.equal(presentations, 1);
    assert.equal(player.world.framePacer.pendingStep, 1);
    assert.equal(player.world.framePacer.dispatchPending, false);
    assert.equal(player.world.framePacer.snapshot().pendingStep, 1);
    await assert.rejects(player.step(1), /actual frame wait/);
  } finally {
    await player?.dispose();
    environment.restore();
  }
});

test('a count0 host callback still observes its wait and presents without an invented update', async () => {
  const environment = startupEnvironment();
  let player,
    timer = 0,
    presentations = 0;
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      configurable: true,
      value: FrameCanvas,
    });
    player = await core(() => timer);
    player.canvas.onPresent = () => presentations++;
    const pc = player.world.main.machine.pc;
    let wait = player.beginFrameWait();
    timer = 8;
    await player.step(0, wait, player.frameWaitTime(wait));
    await player.render();
    assert.equal(player.world.main.machine.pc, pc);
    assert.equal(player.world.frame, 0);
    wait = player.beginFrameWait();
    player.suspendFramePacing();
    timer = 1000;
    wait = player.beginFrameWait();
    timer = 1017;
    await player.step(1, wait, player.frameWaitTime(wait));
    await player.render();
    assert.equal(player.world.frame, 1);
    assert.equal(presentations, 2);
  } finally {
    await player?.dispose();
    environment.restore();
  }
});
