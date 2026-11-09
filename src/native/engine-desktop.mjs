// SPDX-License-Identifier: MPL-2.0
// The original startup queries the virtual desktop through USER32/GDI32.
import { NATIVE_STARTUP_BLOCKS } from './engine-startup-block.mjs';

const DESKTOP_WINDOW = 2;
const DESKTOP_DEPTH = 32;
const layouts = {
  'sdk-4.01-engine-2.6.1.74': [0x4a2750, 0x10788],
  'nekopara-vol3-engine-2.6.1.76': [0x5c5b10, 0x13d40],
};

export function nativeSystemMetric(index, size, touchPoints) {
  if (index === 0 || index === 78) return size()[0];
  if (index === 1 || index === 79) return size()[1];
  if (index === 94) {
    const n = touchPoints?.() ?? globalThis.navigator?.maxTouchPoints ?? 0;
    return n ? (n > 1 ? 0x43 : 3) : 0;
  }
  throw new Error(`GetSystemMetrics(${index}) has no virtual desktop contract`);
}

export function installNativeDesktopAPIs(engine, { displaySize, touchPoints }) {
  const size =
    displaySize ??
    (() => {
      const { configuration, game } = engine.options;
      return [
        configuration.getField('screen.width') || game?.width || 800,
        configuration.getField('screen.height') || game?.height || 600,
      ];
    });
  engine.registerWindows('USER32.dll', 'GetSystemMetrics', {
    count: 1,
    fn: ([index]) => nativeSystemMetric(index, size, touchPoints),
  });
  engine.registerWindows('USER32.dll', 'GetDesktopWindow', {
    count: 0,
    fn: () => DESKTOP_WINDOW,
  });
  engine.registerWindows('GDI32.dll', 'GetDeviceCaps', {
    count: 2,
    fn: ([dc, index]) => {
      engine.textWindows.object(dc, 'dc');
      if (index === 12) return DESKTOP_DEPTH; // BITSPIXEL
      throw new Error(`GetDeviceCaps(${index}) has no virtual desktop contract`);
    },
  });
}

export async function initializeNativeDesktop(engine) {
  const [survey, fields] = layouts[engine.profile],
    p = engine.process,
    block = NATIVE_STARTUP_BLOCKS[engine.profile],
    buffer = p.allocate(12, true);
  try {
    if ((await engine.call(survey, [buffer])) !== 1)
      throw new Error('Original desktop survey did not release its display DC');
    const width = p.load(buffer),
      height = p.load(buffer + 4),
      depth = p.load(buffer + 8);
    if (!width || !height || ![16, 32].includes(depth))
      throw new Error('Original startup rejected the virtual display mode');
    // WinMain clears its change-display flag for this depth and retains the
    // two low WORDs from the desktop survey in its static startup block.
    p.store(block + 44, 0);
    p.store(block + fields, (width & 0xffff) | (height << 16));
  } finally {
    p.free(buffer);
  }
}
