// SPDX-License-Identifier: MPL-2.0
// IDirect3D9 is a platform device, independent of the E-mote DLL. These
// capabilities describe the shared fixed-function browser implementation.
const invalid = 0x8876086c;
const unavailable = 0x8876086a;
const colorFormats = new Set([21, 22]);
const textureFormats = new Set([21, 22, 23, 25, 26, 28, 50, 51]);

export function writeD3D9Caps(owner, adapter, type, output) {
  if (adapter || type !== 1 || !output) return invalid;
  const p = owner.process,
    maximum = owner.maximumTextureSize,
    words = {
      0: 1, // HAL; vertex processing is software, shader versions remain zero.
      20: 0x80000001, // IMMEDIATE and ONE presentation intervals.
      28: 0x40 | 0x100 | 0x200 | 0x400 | 0x80000,
      32: 2 | 0x70 | 0x80 | 0x800 | 0x8000 | 0x20000,
      36:
        1 |
        0x10 |
        0x100 |
        0x10000 |
        0x100000 |
        0x200000 |
        0x400000 |
        0x1000000 |
        0x2000000 |
        0x4000000,
      40: 0xff,
      44: 0x3fff,
      48: 0x3fff,
      52: 0xff,
      56: 0x84008, // Gouraud color, alpha and fog interpolation.
      60: 5, // perspective and alpha, unrestricted NPOT dimensions.
      64: 0x03000300, // point/linear minification and magnification.
      76: 0x1f,
      88: maximum,
      92: maximum,
      100: maximum,
      104: maximum,
      108: 1,
      136: 0xff,
      140: 1,
      144: 0x39effff, // all implemented independent stage operations.
      148: 1,
      152: 1,
      180: 0xfffff,
      184: 0xffffff,
      188: 1,
      192: 256,
      232: 1,
      240: 1,
    };
  p.zero(output, 304);
  for (const [offset, value] of Object.entries(words)) p.store(output + Number(offset), value);
  owner.writeFloats(output + 112, [1e10, -maximum, -maximum, maximum, maximum, 0]);
  owner.writeFloats(output + 176, [1]);
  return 0;
}

export function d3d9AdapterContracts(owner) {
  const p = owner.process,
    modes = (adapter, format) =>
      adapter ? [] : owner.displayModes.filter((mode) => mode.format === format),
    display = (output, mode) => {
      [mode.width, mode.height, mode.refreshRate, mode.format].forEach((value, i) =>
        p.store(output + i * 4, value),
      );
    },
    type = (adapter, deviceType) => adapter === 0 && deviceType === 1,
    format = (adapter, deviceType, adapterFormat, usage, resource, checkFormat) => {
      if (!type(adapter, deviceType)) return invalid;
      if (adapterFormat !== 22) return unavailable;
      if (usage & ~0x603 || (usage & 0x400 && resource !== 3)) return unavailable;
      const supported = usage & 0x400 ? 0x0876086f : 0; // D3DOK_NOAUTOGEN.
      if (usage & 2)
        return resource === 1 && [75, 77, 80].includes(checkFormat) && !(usage & ~2)
          ? 0
          : unavailable;
      if (usage & 1)
        return [1, 3].includes(resource) && colorFormats.has(checkFormat) ? supported : unavailable;
      return [1, 3].includes(resource) && textureFormats.has(checkFormat) ? supported : unavailable;
    };
  return new Map([
    [3, ['RegisterSoftwareDevice', 1, () => unavailable]],
    [4, ['GetAdapterCount', 0, () => 1]],
    [
      5,
      [
        'GetAdapterIdentifier',
        3,
        (_, [adapter, flags, output]) => {
          if (!output) return invalid;
          p.zero(output, 1100);
          if (adapter || flags & ~2) return invalid;
          p.write(output, new TextEncoder().encode('catsystem2-web\0'));
          p.write(
            output + 512,
            new TextEncoder().encode('CatSystem2 Web fixed-function renderer\0'),
          );
          p.write(output + 1024, new TextEncoder().encode('\\\\.\\DISPLAY1\0'));
          p.store(output + 1056, 1);
          return 0;
        },
      ],
    ],
    [6, ['GetAdapterModeCount', 2, (_, [adapter, value]) => modes(adapter, value).length]],
    [
      7,
      [
        'EnumAdapterModes',
        4,
        (_, [adapter, value, index, output]) => {
          const mode = modes(adapter, value)[index];
          if (!mode || !output) return invalid;
          display(output, mode);
          return 0;
        },
      ],
    ],
    [
      8,
      [
        'GetAdapterDisplayMode',
        2,
        (_, [adapter, output]) => {
          if (adapter || !output) return invalid;
          display(output, owner.displayMode);
          return 0;
        },
      ],
    ],
    [
      9,
      [
        'CheckDeviceType',
        5,
        (_, [adapter, deviceType, adapterFormat, backFormat, windowed]) => {
          if (!type(adapter, deviceType)) return invalid;
          if (windowed && !backFormat) backFormat = adapterFormat;
          return adapterFormat === 22 && colorFormats.has(backFormat) ? 0 : unavailable;
        },
      ],
    ],
    [10, ['CheckDeviceFormat', 6, (_, args) => format(...args)]],
    [
      11,
      [
        'CheckDeviceMultiSampleType',
        6,
        (_, [adapter, deviceType, surfaceFormat, , multisample, quality]) => {
          if (!type(adapter, deviceType)) return invalid;
          if (quality) p.store(quality, 0);
          if (
            multisample ||
            (!colorFormats.has(surfaceFormat) && ![75, 77, 80].includes(surfaceFormat))
          )
            return unavailable;
          if (quality) p.store(quality, 1);
          return 0;
        },
      ],
    ],
    [
      12,
      [
        'CheckDepthStencilMatch',
        5,
        (_, [adapter, deviceType, adapterFormat, targetFormat, depthFormat]) => {
          if (!type(adapter, deviceType)) return invalid;
          return adapterFormat === 22 &&
            colorFormats.has(targetFormat) &&
            [75, 77, 80].includes(depthFormat)
            ? 0
            : unavailable;
        },
      ],
    ],
    [
      13,
      [
        'CheckDeviceFormatConversion',
        4,
        (_, [adapter, deviceType, sourceFormat, targetFormat]) => {
          if (!type(adapter, deviceType)) return invalid;
          return colorFormats.has(sourceFormat) && colorFormats.has(targetFormat) ? 0 : unavailable;
        },
      ],
    ],
    [14, ['GetDeviceCaps', 3, (_, args) => writeD3D9Caps(owner, ...args)]],
    [15, ['GetAdapterMonitor', 1, (_, [adapter]) => (adapter ? 0 : owner.monitor)]],
    [16, ['CreateDevice', 6, (_, args) => owner.createDevice(...args)]],
  ]);
}
