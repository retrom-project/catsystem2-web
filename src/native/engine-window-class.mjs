// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// Keep the original class record alive for the application's virtual window.
const layouts = {
  'sdk-4.01-engine-2.6.1.74': [
    0x5c0040,
    0x5bfaa0,
    0xae78a0,
    nativeABI('sdk-4.01-engine-2.6.1.74').layouts.windowClass.suffix,
  ],
  'nekopara-vol3-engine-2.6.1.76': [
    0x70ed40,
    0x70e720,
    0x9e2f98,
    nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.windowClass.suffix,
  ],
};

export async function initializeNativeWindowClass(engine) {
  if (engine.refs.windowClass) throw new Error('Original window class is already initialized');
  const [construct, getProcedure, name, suffix] = layouts[engine.profile],
    p = engine.process,
    instance = engine.module.base,
    loadIcon = engine.kernel.resolve({ dll: 'USER32.dll', name: 'LoadIcon' + suffix }),
    icon = await engine.call(loadIcon, [instance, 103]),
    procedure = await engine.call(getProcedure),
    record = p.allocate(52, true);
  try {
    const result = await engine.call(
        construct,
        [name, procedure, instance, icon, icon, 0, 0, 0, 3],
        record,
      ),
      atom = p.load(record) & 0xffff;
    if (result !== record || !engine.kernel.windowClasses.classes.has(atom))
      throw new Error('Original window class could not be registered');
    engine.refs.windowClass = record;
  } finally {
    if (engine.refs.windowClass !== record) p.free(record);
  }
}

export async function releaseNativeWindowClass(engine) {
  const record = engine.refs.windowClass;
  if (!record) return;
  const [, , , suffix] = layouts[engine.profile],
    p = engine.process,
    atom = p.load(record) & 0xffff,
    unregister = engine.kernel.resolve({ dll: 'USER32.dll', name: 'UnregisterClass' + suffix });
  if ((await engine.call(unregister, [atom, engine.module.base])) !== 1 || !p.free(record))
    throw new Error('Original window class did not release its registration');
  delete engine.refs.windowClass;
}
