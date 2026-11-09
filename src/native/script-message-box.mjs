// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// Main 1BD retains the original VM formatter and crosses the browser boundary
// only at its own MessageBox call, independently of other USER32 callers.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { registryDecodeANSI } from './registry-codepage.mjs';

export const NATIVE_SCRIPT_MESSAGE_BOX = Object.freeze({
  'sdk-4.01-engine-2.6.1.74': {
    handler: 0x51b460,
    site: 0x51b487,
    iat: 0x98e3c8,
    wide: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.scriptMessageBox.wide,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    handler: 0x64fdb0,
    site: 0x64fe07,
    iat: 0x8c641c,
    wide: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.scriptMessageBox.wide,
  },
});
const trapName = 'native Script MessageBox';

class NativeScriptMessageBox {
  constructor(engine, world, layout) {
    Object.assign(this, { engine, world, process: engine.process, layout });
    const p = this.process,
      { site, iat } = layout,
      call = p.read(site, 6);
    if (
      call[0] !== 0xff ||
      call[1] !== 0x15 ||
      new DataView(call.buffer).getUint32(2, true) !== iat
    )
      throw new Error('Original Script MessageBox call has changed');
    this.trap = p.trap(trapName, 4, (args) => this.show(args));
    const branch = new Uint8Array([0xe8, 0, 0, 0, 0, 0x90]);
    new DataView(branch.buffer).setInt32(1, this.trap - site - 5, true);
    p.write(site, branch);
    engine.registerFeature('script-message-box', this);
  }
  async show([owner, message, caption, flags]) {
    if (flags !== 0 || owner !== this.world.window.handle)
      throw new Error('Original Script MessageBox changed its window or button flags');
    const read = (pointer) =>
      this.layout.wide
        ? this.process.string(pointer, true)
        : registryDecodeANSI(this.process.stringBytes(pointer));
    const result = await this.world.window.action('script-message-box', {
      caption: read(caption),
      message: read(message),
    });
    if (result !== 0 && result !== 1)
      throw new TypeError('Script MessageBox requires a Win32 IDOK or failure result');
    return result;
  }
  async invoke(args, machine, task) {
    const p = this.process,
      memory = await this.world.getNativeFeature('task-memory');
    memory.vmPointer(task.id);
    const bridge = new NativeKCSMemory(p, machine, memory.mapMachine(task.id, machine)),
      caller = p.allocate(124, true),
      argv = p.allocate(4),
      out = p.allocate(4);
    try {
      p.store(caller + 120, this.world.window.handle);
      p.store(argv, args[0] ?? machine.nativeArgument(0));
      p.store(out, 0xcccccccc);
      const parameters = [bridge.pointer, caller, argv, out],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(this.layout.handler, parameters, undefined, options)
          : await this.engine.call(this.layout.handler, parameters, undefined, options);
      if (control !== 2 || p.load(out) !== 0xcccccccc)
        throw new Error('Original Script MessageBox changed its output contract');
      return nativeReply(control);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
        p.free(caller);
      }
    }
  }
  recoverTrap(trap) {
    return trap.name === trapName
      ? { args: 4, real: false, handler: (args) => this.show(args) }
      : null;
  }
  snapshot() {
    return { trap: this.trap };
  }
  restore(state) {
    this.trap = state.trap;
  }
}

export function installNativeScriptMessageBox(world) {
  const layout = NATIVE_SCRIPT_MESSAGE_BOX[world.profile];
  if (!layout) return;
  world.registerNativeFeature(
    'script-message-box',
    (engine) => new NativeScriptMessageBox(engine, world, layout),
  );
  world.runtime.register('main', 0x1bd, async (args, machine, task) =>
    (await world.getNativeFeature('script-message-box')).invoke(args, machine, task),
  );
}
