// SPDX-License-Identifier: MPL-2.0
// The reviewed WinMain helper starts with a self-contained block that checks
// KEY_CODE/V_CODE and copies V_CODE2 into the original Settings. Its next
// block opens desktop registration and device services, which are outside
// the browser's prepared-content mount.
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const LAYOUTS = {
  'sdk-4.01-engine-2.6.1.74': {
    entry: 0x4406d0,
    afterResources: 0x440b5d,
    returnSuccess: 0x440faf,
    wide: false,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    entry: 0x52ea10,
    afterResources: 0x52ee7d,
    returnSuccess: 0x52f221,
    wide: true,
  },
};

export class NativeExecutableResources {
  constructor(engine) {
    this.engine = engine;
    const layout = (this.layout = LAYOUTS[engine.profile]),
      p = engine.process;
    engine.registerWindows('USER32.dll', layout.wide ? 'MessageBoxW' : 'MessageBoxA', {
      count: 4,
      fn: ([owner, text, , flags]) => {
        if (!this.loading || owner || flags)
          throw new Error(
            'Unexpected message box outside native executable resource initialization',
          );
        this.loading.message = text ? p.string(text, layout.wide) : '';
        return 1; // IDOK; the original error path still returns failure.
      },
    });
  }
  async initialize() {
    const { engine, layout } = this,
      p = engine.process,
      loading = { reached: false, message: '' };
    if (this.loading || engine.refs.executableResources)
      throw new Error('Original executable resources have already started loading');
    const detach = p.beforeInstruction(
      layout.afterResources,
      'original executable resource block completed',
      () => {
        loading.reached = true;
        // All resource objects are already destroyed. Let the original
        // epilogue restore the stack, registers and exception chain.
        p.cpu.reg_write_i32(p.uc.X86_REG_EIP, layout.returnSuccess);
      },
    );
    this.loading = loading;
    try {
      const result = await p.callAsync(
        layout.entry,
        [engine.module.base],
        NATIVE_STARTUP_BLOCKS[engine.profile],
      );
      if (result !== 1 || !loading.reached)
        throw new Error(
          'Original engine rejected its executable resources' +
            (loading.message ? ': ' + loading.message : ''),
        );
      engine.refs.executableResources = true;
    } finally {
      this.loading = null;
      detach();
    }
  }
}
