// SPDX-License-Identifier: MPL-2.0
// Selected DIBs and display sources share the existing GDI/DC handle owner.
export function installNativeGDIBitmaps(windows) {
  const p = windows.process,
    definitions = windows.definitions,
    previousSelect = definitions.get('SelectObject').fn,
    previousDelete = definitions.get('DeleteObject').fn,
    previousGetDC = definitions.get('GetDC').fn,
    previousReleaseDC = definitions.get('ReleaseDC').fn,
    previousDeleteDC = definitions.get('DeleteDC').fn,
    define = (name, count, fn) => definitions.set(name, { count, fn });
  windows.windowPixelSources = new Map();
  const stockBitmap = () => {
    for (const [handle, object] of windows.objects)
      if (object.kind === 'bitmap' && object.stock) return handle;
    return windows.createObject('bitmap', {
      stock: true,
      pixels: p.allocate(4, true),
      width: 1,
      height: 1,
      signedHeight: 1,
      bpp: 1,
      stride: 4,
      masks: [0, 0, 0],
      compression: 0,
      colorsUsed: 2,
      colorsImportant: 0,
      xPixelsPerMeter: 0,
      yPixelsPerMeter: 0,
    });
  };
  const selected = (handle) =>
    [...windows.objects.values()].some((o) => o.kind === 'dc' && o.bitmap === handle);
  const releaseSelection = (dc) => {
    const handle = dc.bitmap,
      object = windows.objects.get(handle);
    dc.bitmap = 0;
    if (object?.pendingDelete && !selected(handle)) previousDelete([handle]);
  };
  define('GetDC', 1, (args) => {
    const handle = previousGetDC(args);
    windows.object(handle, 'dc').window = args[0];
    return handle;
  });
  define('CreateCompatibleDC', 1, ([source]) => {
    if (source) windows.object(source, 'dc');
    return windows.createObject('dc', { font: 0, bitmap: stockBitmap(), stretchMode: 1 });
  });
  define('ReleaseDC', 2, (args) => {
    const dc = windows.objects.get(args[1]);
    if (dc) releaseSelection(dc);
    return previousReleaseDC(args);
  });
  define('DeleteDC', 1, (args) => {
    const dc = windows.objects.get(args[0]);
    if (dc) releaseSelection(dc);
    return previousDeleteDC(args);
  });
  define('SelectObject', 2, ([dcHandle, handle]) => {
    const dc = windows.object(dcHandle, 'dc'),
      object = windows.objects.get(handle);
    if (object?.kind === 'bitmap') {
      if (
        !object.stock &&
        [...windows.objects].some(
          ([id, o]) => id !== dcHandle && o.kind === 'dc' && o.bitmap === handle,
        )
      )
        return 0;
      const old = dc.bitmap ?? stockBitmap();
      if (old === handle) return old;
      releaseSelection(dc);
      dc.bitmap = handle;
      return old;
    }
    if (object?.kind === 'brush') {
      const old = dc.brush ?? 0;
      dc.brush = handle;
      return old;
    }
    return previousSelect([dcHandle, handle]);
  });
  define('GetCurrentObject', 2, ([dcHandle, kind]) => {
    const dc = windows.object(dcHandle, 'dc');
    if (kind === 7) return dc.bitmap ?? 0;
    if (kind === 6) return dc.font;
    if (kind === 2) return dc.brush ?? 0;
    return 0;
  });
  define('DeleteObject', 1, ([handle]) => {
    const object = windows.objects.get(handle);
    if (object?.stock) return 1;
    if (object?.kind === 'bitmap' && selected(handle)) {
      object.pendingDelete = true;
      return 1;
    }
    return previousDelete([handle]);
  });
  define('CreateSolidBrush', 1, ([color]) => windows.createObject('brush', { color: color >>> 0 }));
  define('SetStretchBltMode', 2, ([dcHandle, mode]) => {
    const dc = windows.object(dcHandle, 'dc');
    if (![1, 2, 3, 4].includes(mode)) return 0;
    const old = dc.stretchMode ?? 1;
    dc.stretchMode = mode;
    return old;
  });
  define('GetStretchBltMode', 1, ([dc]) => windows.object(dc, 'dc').stretchMode ?? 1);
  const bitmapFor = (dc) => {
    const bitmap = windows.object(dc.bitmap, 'bitmap');
    if (![24, 32].includes(bitmap.bpp))
      throw new Error('GDI pixel operations require their 24/32-bit bitmap adapter');
    return bitmap;
  };
  const pixelOffset = (bitmap, x, y) =>
    (bitmap.signedHeight < 0 ? y : bitmap.height - y - 1) * bitmap.stride + x * (bitmap.bpp / 8);
  const brushBytes = (handle) => {
    const color = windows.object(handle, 'brush').color;
    return [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, 0];
  };
  define('FillRect', 3, ([dcHandle, rect, brush]) => {
    const bitmap = bitmapFor(windows.object(dcHandle, 'dc')),
      color = brushBytes(brush),
      bytes = p.read(bitmap.pixels, bitmap.stride * bitmap.height),
      edges = Array.from({ length: 4 }, (_, i) => p.load(rect + i * 4) | 0),
      xShift = Number(edges[2] < edges[0]),
      yShift = Number(edges[3] < edges[1]),
      x0 = Math.max(0, Math.min(edges[0], edges[2]) + xShift),
      x1 = Math.min(bitmap.width, Math.max(edges[0], edges[2]) + xShift),
      y0 = Math.max(0, Math.min(edges[1], edges[3]) + yShift),
      y1 = Math.min(bitmap.height, Math.max(edges[1], edges[3]) + yShift);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const at = pixelOffset(bitmap, x, y);
        for (let c = 0; c < bitmap.bpp / 8; c++) bytes[at + c] = color[c];
      }
    p.write(bitmap.pixels, bytes);
    return 1;
  });
  const sourceFor = (dc) => {
    if (dc.bitmap) {
      const bitmap = bitmapFor(dc),
        bytes = p.read(bitmap.pixels, bitmap.stride * bitmap.height);
      return {
        width: bitmap.width,
        height: bitmap.height,
        pixel: (x, y) => {
          const at = pixelOffset(bitmap, x, y);
          return [bytes[at], bytes[at + 1], bytes[at + 2], bitmap.bpp === 32 ? bytes[at + 3] : 0];
        },
      };
    }
    const provider = windows.windowPixelSources.get(dc.window);
    if (typeof provider !== 'function')
      throw new Error('GDI display capture requires its actual browser window surface');
    const { width, height, rgba } = provider();
    if (!Number.isInteger(width) || !Number.isInteger(height) || rgba.length !== width * height * 4)
      throw new Error('Invalid browser window pixel source');
    return {
      width,
      height,
      pixel: (x, y) => {
        const at = (y * width + x) * 4;
        return [rgba[at + 2], rgba[at + 1], rgba[at], 0];
      },
    };
  };
  const axis = (destination, source, mode) => {
    const rows = Array.from({ length: destination }, () => []);
    if (source > destination && mode !== 3) {
      for (let i = 0; i < source; i++)
        rows[Math.floor(((2 * i + 1) * destination - 1) / (2 * source))].push(i);
    } else
      for (let i = 0; i < destination; i++)
        rows[i].push(
          Math.floor(((2 * i + 1) * source - Number(destination >= source)) / (2 * destination)),
        );
    return rows;
  };
  const coordinate = (origin, extent, index) => (extent < 0 ? origin - index : origin + index);
  const operation = (rop, source, destination, pattern) => {
    let output = 0;
    for (let bit = 0; bit < 8; bit++) {
      const index =
        (((pattern >>> bit) & 1) << 2) |
        (((source >>> bit) & 1) << 1) |
        ((destination >>> bit) & 1);
      output |= ((rop >>> index) & 1) << bit;
    }
    return output;
  };
  const stretch = ([destHandle, dx, dy, dw, dh, sourceHandle, sx, sy, sw, sh, rawROP]) => {
    [dx, dy, dw, dh, sx, sy, sw, sh] = [dx, dy, dw, dh, sx, sy, sw, sh].map((v) => v | 0);
    const dc = windows.object(destHandle, 'dc'),
      bitmap = bitmapFor(dc),
      mode = dc.stretchMode ?? 1;
    if (!dw || !dh || !sw || !sh) return 1;
    if (mode === 4)
      throw new Error('GDI HALFTONE stretching requires its separately verified filter');
    if (Math.max(Math.abs(dw), Math.abs(dh), Math.abs(sw), Math.abs(sh)) > 65536)
      throw new RangeError('GDI stretch dimensions exceed their bitmap boundary');
    const source = sourceFor(windows.object(sourceHandle, 'dc')),
      xs = axis(Math.abs(dw), Math.abs(sw), mode),
      ys = axis(Math.abs(dh), Math.abs(sh), mode),
      output = p.read(bitmap.pixels, bitmap.stride * bitmap.height),
      rop = (rawROP >>> 16) & 255,
      pattern = dc.brush ? brushBytes(dc.brush) : [255, 255, 255, 0];
    for (let yi = 0; yi < ys.length; yi++)
      for (let xi = 0; xi < xs.length; xi++) {
        const x = coordinate(dx, dw, xi),
          y = coordinate(dy, dh, yi);
        if (x < 0 || x >= bitmap.width || y < 0 || y >= bitmap.height) continue;
        let color = null;
        for (const iy of ys[yi])
          for (const ix of xs[xi]) {
            const u = coordinate(sx, sw, ix),
              v = coordinate(sy, sh, iy);
            if (u < 0 || u >= source.width || v < 0 || v >= source.height) continue;
            const sample = source.pixel(u, v);
            if (!color) color = sample;
            else
              for (let c = 0; c < 4; c++)
                color[c] = mode === 2 ? color[c] | sample[c] : color[c] & sample[c];
          }
        if (!color) continue;
        const at = pixelOffset(bitmap, x, y);
        for (let c = 0; c < bitmap.bpp / 8; c++)
          output[at + c] = operation(rop, color[c], output[at + c], pattern[c]);
      }
    p.write(bitmap.pixels, output);
    return 1;
  };
  define('StretchBlt', 11, stretch);
  define('BitBlt', 9, ([dest, dx, dy, w, h, source, sx, sy, rop]) =>
    stretch([dest, dx, dy, w, h, source, sx, sy, w, h, rop]),
  );
}
