// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const layouts = {
  'sdk-4.01-engine-2.6.1.74': {
    entry: 0x5bfb00,
    idle: 0x5bfb12,
    get: 0x5bfb54,
    next: 0x5bfc1e,
    quit: 0x5bfc3a,
    exit: 0x5bfc3e,
    mask: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.windowPump.mask,
  },
  'nekopara-vol3-engine-2.6.1.76': {
    entry: 0x70e7e0,
    idle: 0x70e7f2,
    get: 0x70e834,
    next: 0x70e8fe,
    quit: 0x70e91a,
    exit: 0x70e91e,
    mask: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.windowPump.mask,
  },
};

export async function runNativeWindowPump(engine, handle, host) {
  const p = engine.process,
    { cpu, uc } = p,
    { messageQueue, events, windowViews } = engine.kernel,
    owner = p.load(NATIVE_STARTUP_BLOCKS[engine.profile]),
    layout = layouts[engine.profile];
  if (!owner || p.load(owner) !== handle || windowViews.windows.get(handle)?.userData !== owner)
    throw new Error('Original message loop requires the startup window');
  const ready = () => {
    messageQueue.advanceTimers();
    const event = p.load(owner + 0x54);
    if (!event) return messageQueue.pending;
    return (
      Boolean(messageQueue.changed & layout.mask) || events.poll([event], false, false) !== null
    );
  };
  if (!ready()) return null;
  if (messageQueue.dispatchToHost)
    throw new Error('Original window message loop is already running');
  const deliveries = [],
    detach = [],
    observe = (address, label, fn) => detach.push(p.beforeInstruction(address, label, fn)),
    jump = (address) => cpu.reg_write_i32(uc.X86_REG_EIP, address),
    park = () => {
      cpu.reg_write_i32(uc.X86_REG_EAX, 0);
      jump(layout.exit);
    };
  let resume = false,
    boundary,
    messages = 0,
    idlePasses = 0;
  try {
    observe(layout.idle, 'original kcWindow idle wait', () => {
      if (resume) {
        // The prologue restored EBX, ESI and the MSG scratch frame. Peek
        // again before waiting for new input, including unread old posts.
        resume = false;
        jump(layout.next);
      } else if (!ready()) {
        boundary = 'idle';
        park();
      } else if (++idlePasses > 10000) throw new Error('Native window idle work did not settle');
    });
    observe(layout.get, 'original kcWindow message retrieval', () => {
      if (++messages > 10000) throw new Error('Native window message queue did not settle');
    });
    observe(layout.next, 'original kcWindow host dispatch', () => {
      // The browser services may make their own serialized guest calls.
      // Leave the original pump before running those services.
      if (deliveries.length) {
        boundary = 'delivery';
        park();
      }
    });
    observe(layout.quit, 'original kcWindow quit result', () => {
      boundary = 'quit';
    });
    while (!host.stopping()) {
      boundary = undefined;
      messageQueue.dispatchToHost = (target, message, wParam, lParam) => {
        if (target !== handle) return false;
        deliveries.push({ message, wParam, lParam });
        return host.handles(message, wParam);
      };
      let result;
      try {
        result = await engine.call(layout.entry, [], owner);
      } finally {
        delete messageQueue.dispatchToHost;
      }
      if (boundary === 'quit') return result | 0;
      if (boundary === 'idle') return null;
      if (boundary !== 'delivery') throw new Error('Original message loop returned unexpectedly');
      for (const message of deliveries.splice(0)) {
        if (host.stopping()) return null;
        await host.deliver(message);
      }
      resume = true;
    }
    return null;
  } finally {
    for (const unhook of detach.reverse()) unhook();
  }
}
