// SPDX-License-Identifier: MPL-2.0
// GDI DIB ownership shares the font/DC handle namespace and guest RAM.
export function installNativeDIBs(windows) {
  const p = windows.process,
    definitions = windows.definitions,
    remove = definitions.get('DeleteObject').fn,
    definition = (name, count, fn) => definitions.set(name, { count, fn });
  definition('CreateDIBSection', 6, ([dc, info, usage, bitsOut, section, offset]) => {
    if (section || offset)
      throw new Error('File-backed native DIB sections require their mapping owner');
    if (dc) windows.object(dc, 'dc');
    if (bitsOut) p.store(bitsOut, 0);
    if (!info) return 0;
    const header = p.load(info),
      width = p.load(info + 4) | 0,
      signedHeight = p.load(info + 8) | 0,
      planes = p.load(info + 12) & 65535,
      bpp = p.load(info + 12) >>> 16,
      compression = p.load(info + 16),
      height = Math.abs(signedHeight),
      stride = Math.ceil((width * bpp) / 32) * 4;
    if (
      ![40, 108, 124].includes(header) ||
      width <= 0 ||
      height === 0 ||
      planes !== 1 ||
      ![1, 4, 8, 16, 24, 32].includes(bpp) ||
      ![0, 3].includes(compression) ||
      usage > 1
    )
      return 0;
    if (stride * height > 0x10000000) throw new RangeError('Native DIB exceeds its resource limit');
    let masks = [0, 0, 0];
    if (compression === 3) {
      if (![16, 32].includes(bpp)) return 0;
      masks = Array.from({ length: 3 }, (_, i) => p.load(info + 40 + i * 4));
      if (
        masks.some((n) => !n) ||
        masks[0] & masks[1] ||
        masks[0] & masks[2] ||
        masks[1] & masks[2]
      )
        return 0;
    } else if (bpp === 16) masks = [0x7c00, 0x3e0, 0x1f];
    const pixels = p.allocate(stride * height, true),
      handle = windows.createObject('bitmap', {
        pixels,
        width,
        height,
        signedHeight,
        bpp,
        stride,
        masks,
        compression: compression === 3 || bpp === 16 ? 3 : 0,
        xPixelsPerMeter: p.load(info + 24),
        yPixelsPerMeter: p.load(info + 28),
        colorsUsed: bpp <= 8 ? 1 << bpp : 0,
        colorsImportant: p.load(info + 36),
      });
    if (bitsOut) p.store(bitsOut, pixels);
    return handle;
  });
  for (const suffix of ['A', 'W'])
    definition(`GetObject${suffix}`, 3, ([handle, size, out]) => {
      const bitmap = windows.objects.get(handle);
      if (!bitmap) return 0;
      if (bitmap.kind !== 'bitmap')
        throw new Error('Native GDI GetObject requires this object description');
      if (!out) return 24;
      if ((size | 0) < 24) return 0;
      const bytes = new Uint8Array(size >= 84 ? 84 : 24),
        view = new DataView(bytes.buffer),
        fields = [
          0,
          bitmap.width,
          bitmap.height,
          bitmap.stride,
          (bitmap.bpp << 16) | 1,
          bitmap.pixels,
        ];
      if (bytes.length === 84)
        fields.push(
          40,
          bitmap.width,
          bitmap.height,
          (bitmap.bpp << 16) | 1,
          bitmap.compression,
          bitmap.stride * bitmap.height,
          bitmap.xPixelsPerMeter,
          bitmap.yPixelsPerMeter,
          bitmap.colorsUsed,
          bitmap.colorsImportant,
          ...bitmap.masks,
          0,
          0,
        );
      fields.forEach((n, i) => view.setUint32(i * 4, n, true));
      p.write(out, bytes);
      return bytes.length;
    });
  definition('DeleteObject', 1, ([handle]) => {
    const object = windows.objects.get(handle);
    if (object?.kind === 'bitmap') {
      if (!p.free(object.pixels)) throw new Error('Native DIB pixel allocation was released twice');
    }
    return remove([handle]);
  });
}
