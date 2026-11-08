// SPDX-License-Identifier: MPL-2.0
// Main CC..CF uses the supplied original engine's matrix implementation and
// D3DX dispatch. The current matrix for a translated NULL pointer remains in
// that shared process, together with the original matrix stack.
import { nativeReply } from '../kcs/vm.mjs';

const operations = {
  'nekopara-vol3-engine-2.6.1.76': {
    rotate: [0x678680, 0x6786e0, 0x678740],
    translate: 0x678820,
    scale: 0x6787a0,
    identity: 0x678500,
  },
  'sdk-4.01-engine-2.6.1.74': {
    rotate: [0x54f400, 0x54f460, 0x54f4c0],
    translate: 0x54f5a0,
    scale: 0x54f520,
    identity: 0x54f280,
  },
};
export class NativeMatrices {
  constructor(engine) {
    this.engine = engine;
    this.operations = operations[engine.profile];
    if (!this.operations) throw new Error('Native matrices require a reviewed engine profile');
    engine.registerFeature('matrix', this);
  }
  async apply(id, args, machine) {
    if (id < 0xcc || id > 0xcf) return undefined;
    const count = id === 0xcf ? 1 : 4;
    if (args.length !== count)
      throw new Error(`Native matrix 0x${id.toString(16)} expects ${count} arguments`);
    let mapped = false;
    try {
      machine.region(args[0] >>> 0, 1);
      mapped = true;
    } catch {
      /* Native VM translates an unmapped address to NULL. */
    }
    const bytes = mapped ? machine.bytes(args[0], 64).slice() : null,
      p = this.engine.process,
      pointer = mapped ? p.allocate(64, true) : 0;
    try {
      if (bytes) p.write(pointer, bytes);
      if (id === 0xcc) {
        for (let i = 0; i < 3; i++)
          await this.engine.call(this.operations.rotate[i], [pointer, args[i + 1]]);
      } else
        await this.engine.call(
          this.operations[id === 0xcd ? 'translate' : id === 0xce ? 'scale' : 'identity'],
          [pointer, ...args.slice(1)],
        );
      if (bytes) {
        const result = p.read(pointer, 64);
        machine.bytes(args[0], 64).set(result);
      }
      return nativeReply(2);
    } finally {
      if (pointer) p.free(pointer);
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeMatrices(world) {
  world.registerNativeFeature('matrix', (engine) => new NativeMatrices(engine));
  for (let id = 0xcc; id <= 0xcf; id++)
    world.runtime.register('main', id, async (args, machine) =>
      (await world.getNativeFeature('matrix')).apply(id, args, machine),
    );
}
