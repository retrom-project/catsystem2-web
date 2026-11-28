// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { floatBits } from '../../src/kcs.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { nativeRectangleDefinitions } from '../../src/native/windows-rectangles.mjs';
import { viewStateBytes } from './view-state.mjs';
export const viewRectangleOracle = {
  prepare(engine, fixture) {
    const p = engine.process,
      abi = nativeABI(fixture.profile),
      owned = [];
    const allocate = (size) => {
      const a = p.allocate(size, true);
      owned.push(a);
      return a;
    };
    for (const [name, definition] of nativeRectangleDefinitions(p))
      engine.registerWindows('USER32.dll', name, definition);
    const adapter = {
      close() {
        for (const a of owned) p.free(a);
      },
    };
    if (fixture.domain === 'view') {
      const caller = allocate(120),
        view = allocate(280),
        manager = allocate(544),
        view3D = allocate(200);
      const v = {
        virtualWidth: 640,
        virtualHeight: 480,
        clientWidth: 640,
        clientHeight: 480,
        deviceOffset: [0, 0],
        deviceScale: 1,
        windowShift: [0, 0],
        active: true,
        drawingRectangle: [0, 0, 640, 480],
        ratios: null,
        ...fixture.initial?.view,
      };
      p.store(caller + 116, view);
      p.store(view, Number(!v.active));
      p.store(view + 4, view3D);
      p.store(view + 8, manager);
      p.store(view + 24, v.virtualWidth);
      p.store(view + 28, v.virtualHeight);
      const ratios = v.ratios ?? [
        Math.fround(v.virtualWidth / v.clientWidth),
        Math.fround(v.virtualHeight / v.clientHeight),
      ];
      ratios.forEach((n, i) => p.store(view + 68 + i * 4, floatBits(n)));
      p.store(manager + 224, fixture.initial?.cameraNearWord ?? floatBits(1000));
      v.deviceOffset.forEach((n, i) => p.store(manager + 228 + i * 4, floatBits(n)));
      p.store(manager + 484, floatBits(v.deviceScale));
      v.drawingRectangle.forEach((n, i) => p.store(manager + 500 + i * 4, n));
      // Settings are explicit fixture input; production does not read this layout.
      for (const [name, n] of Object.entries({
        fullPosition: 0,
        fullHeight: 480,
        currentHeight: 480,
        virtualHeight: 480,
        ...fixture.initial?.screen,
      })) {
        const field = abi.configuration.memory.scalarFields.find(
          ([path]) => path === 'screen.' + name,
        );
        if (!field) throw Error('Missing ABI screen field ' + name);
        const [, offset, size] = field,
          b = new Uint8Array(size),
          d = new DataView(b.buffer);
        if (size === 2) d.setUint16(0, n, true);
        else d.setUint32(0, n, true);
        p.write(engine.refs.owner + offset, b);
      }
      // Original window displacement resides in settings outside scalarFields.
      const shift = fixture.profile === 'sdk-4.01-engine-2.6.1.74' ? 0xb8f4 : 0xc35c;
      v.windowShift.forEach((n, i) => p.store(engine.refs.settings + shift + i * 4, n));
      const beforeView = p.read(view, 280).slice(),
        beforeManager = p.read(manager, 544).slice();
      Object.assign(adapter, {
        caller,
        memory() {
          assert.deepEqual(p.read(view, 280), beforeView, 'view query does not mutate view');
          const expected = beforeManager.slice();
          new DataView(expected.buffer).setUint32(224, p.load(manager + 224), true);
          assert.deepEqual(p.read(manager, 544), expected, 'only camera state may change');
          return {
            'state:view': viewStateBytes({ cameraNearWord: p.load(manager + 224), view: v }),
          };
        },
      });
    }
    if (fixture.initial?.bitmap) {
      const b = fixture.initial.bitmap,
        wrapper = allocate(4),
        bitmap = allocate(92);
      p.store(wrapper, bitmap);
      p.store(bitmap + 4, b.width);
      p.store(bitmap + 8, b.height);
      adapter.arguments = (args) => args.map((word, i) => (i === 1 ? wrapper : word));
    }
    return adapter;
  },
};
