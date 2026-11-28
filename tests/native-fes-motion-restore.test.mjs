// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESPlayer } from '../src/fes/player.mjs';
import { MotionManager } from '../src/motion/manager.mjs';
import { Binary } from '../src/binary.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { memoryGame, u32 } from './helpers.mjs';

for (const active of [false, true])
  test(`FES restores object commands independently of ${active ? 'active' : 'completed'} MOT working state`, async () => {
    const source = `#DEFINE
CPLANE mask
#OBJECT SIZE POS COLOR DISP
mask 4,4 0,0 0xff000000 1
#SUBCOMMAND
${active ? 'continue' : 'oneshot'} custom authored-position PX[0] : [0]
#START
mask custom 11
next WAIT
#WAIT
#MANUAL
mask disp 0
mask pos 37 19
`,
      shared = (offset) => [0x13, 0x80000000 + offset],
      instructions = [
        [21, shared(MOTION_ABI.pos), shared(MOTION_ABI.registers)],
        ...(!active ? [[43, [3, 38], [3, 0]]] : []),
        [59],
      ],
      body = Uint8Array.from(
        instructions.flatMap(([op, ...args]) => [
          op,
          ...args.flatMap(([mode, value]) => [mode, ...u32(value)]),
        ]),
      ),
      script = {
        name: 'authored-position',
        body: new Binary(body),
        codeSize: body.length,
        data: new Uint8Array(16),
        stackSize: 1024,
      },
      library = {
        load: async () => script,
        manager: (base, speed) =>
          new MotionManager({
            profile: 'nekopara-vol3-engine-2.6.1.76',
            base,
            speed,
            loadScript: async () => script,
          }),
      },
      game = memoryGame({ 'screen.fes': new TextEncoder().encode(source) }),
      make = async () => {
        const p = new FESPlayer(game, {}, {});
        p.motionLibrary = library;
        await p.start('screen');
        return p;
      },
      first = await make();
    await first.step();
    const before = first.root.byKey.get('mask');
    assert.equal(before.x, 11);
    assert.equal(before.motionBusy, active);
    first.root.invoke('MANUAL');
    await first.flush();
    assert.deepEqual([before.disp, before.x, before.y], [false, 37, 19]);
    const saved = structuredClone(first.snapshot()),
      fresh = await make();
    await fresh.restore(saved);
    const after = fresh.root.byKey.get('mask');
    assert.deepEqual([after.disp, after.x, after.y], [false, 37, 19]);
    assert.deepEqual(
      fresh.snapshot(),
      saved,
      'restoring a motion driver must not replay its cached output into the owner',
    );
    await first.step();
    await fresh.step();
    assert.deepEqual(
      fresh.snapshot(),
      first.snapshot(),
      'both instances continue the original next motion frame',
    );
  });
