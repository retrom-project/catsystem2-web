// SPDX-License-Identifier: MPL-2.0
// The reviewed WinMain helper starts with a self-contained block that checks
// KEY_CODE/V_CODE and copies V_CODE2 into the original Settings. Its next
// block opens desktop registration and device services, which are outside
// the browser's prepared-content mount.
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

export async function initializeNativeExecutableResources(engine) {
  const layout = LAYOUTS[engine.profile],
    p = engine.process;
  let reached = false,
    message = '',
    active = true;
  engine.registerWindows('USER32.dll', layout.wide ? 'MessageBoxW' : 'MessageBoxA', {
    count: 4,
    fn: ([owner, text, , flags]) => {
      if (!active || owner || flags)
        throw new Error('Unexpected message box outside native executable resource initialization');
      message = text ? p.string(text, layout.wide) : '';
      return 1; // IDOK; the original error path still returns failure.
    },
  });
  const detach = p.beforeInstruction(
    layout.afterResources,
    'original executable resource block completed',
    () => {
      reached = true;
      // All resource objects are already destroyed. Let the original
      // epilogue restore the stack, registers and exception chain.
      p.cpu.reg_write_i32(p.uc.X86_REG_EIP, layout.returnSuccess);
    },
  );
  try {
    const result = await p.callAsync(layout.entry, [engine.module.base], engine.refs.owner);
    if (result !== 1 || !reached)
      throw new Error(
        'Original engine rejected its executable resources' + (message ? ': ' + message : ''),
      );
  } finally {
    active = false;
    detach();
  }
}
