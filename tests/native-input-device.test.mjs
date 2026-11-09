// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeSystemClock } from '../src/native/clock.mjs';
import { NativeInput } from '../src/native/input.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { NativeInputDevice } from '../src/native/input-device.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} original window input device owns real key/gesture state and restores in a fresh process`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable]));
      const make = async () => {
        const configuration = new NativeConfiguration({ profile });
        configuration.setField('application.touch', 1);
        for (const row of configuration.keys.rows) row.enabled = 0;
        const row = configuration.keys.rows[0];
        row.enabled = 1;
        row.keyboard.set([65, 244, 245, 246]);
        row.mouse[0] = 1;
        row.rep_keyboard[0] = 1;
        const engine = await NativeEngineProcess.open({
            bytes,
            profile,
            configuration,
            clock: new NativeSystemClock({ utcNow: () => 0 }),
            now: () => 0,
          }),
          input = new NativeInput({ configuration }),
          world = {
            input,
            configuration,
            host: { nativeTouchPoints: () => 2 },
            game: { width: 800, height: 600 },
            windowMessages: [],
          };
        world.inputBindings = new NativeInputBindings(input, configuration);
        return { engine, world, device: new NativeInputDevice(engine, world) };
      };
      const first = await make();
      let fresh;
      try {
        const { engine, world, device } = first,
          p = engine.process,
          bindings = world.inputBindings,
          ptr = await device.pointer();
        assert.ok(ptr > 0);
        assert.equal(p.load(ptr + 8), device.refs.window);
        assert.ok(p.allocations.has(device.refs.window));
        await device.event(0x100, 65, 0);
        assert.equal(bindings.sampled[0], 1);
        assert.equal(bindings.live[0], 1);
        assert.equal(bindings.mouseState[2], 2);
        await device.finishFrame();
        await device.event(0x101, 65, 0);
        assert.equal(bindings.sampled[0], 1);
        assert.equal(bindings.live[0], 0);
        assert.equal(bindings.mouseState[2], 0);
        await device.finishFrame();
        assert.equal(bindings.sampled[0], 0);
        bindings.keyboard({ code: 'KeyA' }, true);
        bindings.sample();
        await device.poll();
        assert.equal(bindings.sampled[0], 1);
        assert.equal(bindings.down.keyboard.has(65), true);
        await device.finishFrame();
        bindings.keyboard({ code: 'KeyA' }, false);
        bindings.sample();
        await device.poll();
        assert.equal(bindings.live[0], 0);
        await device.finishFrame();
        bindings.mouse(0, true);
        bindings.sample();
        await device.poll();
        assert.equal(bindings.live[0], 2);
        bindings.releasePointer();
        bindings.sample();
        await device.poll();
        assert.equal(bindings.live[0], 0);
        await device.finishFrame();
        bindings.keyboard({ code: 'KeyA' }, true);
        bindings.sample();
        await device.poll();
        bindings.releaseAll();
        bindings.sample();
        await device.poll();
        assert.equal(bindings.live[0], 0);
        assert.equal(p.load(device.refs.window + 1576), 0);
        await device.event(0x201, 0, 0);
        assert.equal(bindings.sampled[0], 2);
        assert.equal(bindings.mouseState[0] & 2, 2);
        await device.event(0x202, 0, 0);
        assert.equal(bindings.live[0], 0);
        assert.equal(bindings.mouseState[0] & 2, 0);
        await device.finishFrame();
        assert.equal(await device.touch([{ id: 55, x: 100, y: 80, phase: 'down' }]), 1);
        assert.equal(bindings.pointerActivation, true);
        const user32 = engine.kernel.moduleHandle('user32.dll');
        assert.ok(user32);
        assert.ok(engine.kernel.moduleHandle('winmm.dll'));
        await device.touch([{ id: 55, x: 120, y: 80, phase: 'move' }]);
        await device.poll();
        const bank = bindings.snapshot(),
          snapshot = engine.snapshot(),
          windowPointer = device.refs.window;
        fresh = await make();
        fresh.world.inputBindings.restore(bank);
        fresh.engine.restore(snapshot);
        assert.equal(fresh.engine.kernel.moduleHandle('user32.dll'), user32);
        assert.equal(await fresh.device.pointer(), ptr);
        assert.equal(fresh.device.refs.window, windowPointer);
        assert.equal(await fresh.device.touch([{ id: 55, x: 120, y: 80, phase: 'up' }]), 1);
        await fresh.device.poll();
        await fresh.device.finishFrame();
        assert.equal(fresh.engine.process.load(windowPointer + 1560), 0);
        await fresh.device.control('touchEnable', 0);
        assert.equal(fresh.engine.process.load(windowPointer + 1556), 0);
        await fresh.device.control('touchEnable', 1);
        assert.equal(fresh.engine.process.load(windowPointer + 1556), 1);
        await fresh.device.control('touchReset');
        await fresh.device.control('wheelCancel');
        await fresh.device.control('clear');
        const allocated = fresh.device.refs.pointer;
        await fresh.device.close();
        await fresh.device.close();
        assert.equal(fresh.device.refs.ready, false);
        assert.equal(fresh.engine.process.allocations.has(allocated), false);
      } finally {
        await first.engine.close();
        await fresh?.engine.close();
      }
    },
  );
