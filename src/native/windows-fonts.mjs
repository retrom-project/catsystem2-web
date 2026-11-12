// SPDX-License-Identifier: MPL-2.0
import { writeNativeFontField as field, nativeFontFamilyRows } from './font-catalog.mjs';

function logFont(font, wide) {
  const unit = wide ? 2 : 1,
    bytes = new Uint8Array(28 + 160 * unit),
    view = new DataView(bytes.buffer);
  [font.height, font.width, 0, 0, font.weight].forEach((word, i) =>
    view.setInt32(i * 4, word, true),
  );
  bytes.set([font.italic, 0, 0, font.charset, 0, 0, 0, font.pitchAndFamily], 20);
  field(bytes, 28, 32, font.face, wide);
  field(bytes, 28 + 32 * unit, 64, font.fullName ?? font.face, wide);
  field(bytes, 28 + 96 * unit, 32, font.style ?? '', wide);
  field(bytes, 28 + 128 * unit, 32, font.script ?? '', wide);
  return bytes;
}

function textMetric(font, metrics, wide) {
  const base = wide ? 60 : 56,
    bytes = new Uint8Array(base + 40),
    view = new DataView(bytes.buffer),
    fixedPitch = (font.pitchAndFamily & 3) === 1,
    type = font.type ?? 4;
  [
    metrics.height,
    metrics.ascent,
    metrics.descent,
    0,
    0,
    metrics.averageWidth,
    metrics.maximumWidth,
    font.weight,
    0,
    96,
    96,
  ].forEach((word, i) => view.setInt32(i * 4, word, true));
  const chars = [font.firstChar ?? 0, font.lastChar ?? 0, font.defaultChar ?? 0, 32];
  chars.forEach((word, i) => {
    if (wide) view.setUint16(44 + i * 2, word, true);
    else bytes[44 + i] = word;
  });
  const pitch = (font.pitchAndFamily & 0xf0) | Number(!fixedPitch) | (type & 4 ? 6 : 0);
  bytes.set([font.italic, 0, 0, pitch, font.charset], wide ? 52 : 48);
  const style = (font.italic ? 1 : 0) | (font.weight >= 700 ? 32 : 0);
  view.setUint32(base, style || 64, true);
  [font.unitsPerEm, font.cellHeight, font.averageWidth].forEach((word, i) =>
    view.setUint32(base + 4 + i * 4, word ?? 0, true),
  );
  font.signature?.slice(0, 6).forEach((word, i) => view.setUint32(base + 16 + i * 4, word, true));
  return bytes;
}

export function installNativeFontEnumeration(windows) {
  const p = windows.process;
  for (const suffix of ['A', 'W']) {
    const wide = suffix === 'W';
    windows.definitions.set(`EnumFontFamilies${suffix}`, {
      count: 4,
      fn: async ([dc, family, callback, parameter]) => {
        if (windows.objects.get(dc)?.kind !== 'dc' || !callback) return 0;
        const name = family ? p.string(family, wide).toLowerCase() : null,
          faces = nativeFontFamilyRows(windows.fontFamilies(), name);
        if (!faces.length) return 1;
        const fontOut = p.allocate(wide ? 348 : 188, true),
          metricOut = p.allocate(wide ? 100 : 96, true);
        let result = 1;
        try {
          for (const row of faces) {
            const font = {
              height: 16,
              width: 0,
              italic: 0,
              charset: 1,
              pitchAndFamily: 0,
              weight: 400,
              ...row,
            };
            p.write(fontOut, logFont(font, wide));
            p.write(metricOut, textMetric(font, windows.glyphs.measure(font, 'Hg'), wide));
            result = await p.callFromHost(callback, [
              fontOut,
              metricOut,
              font.type ?? 4,
              parameter,
            ]);
            if (!result) break;
          }
          return result;
        } finally {
          p.free(metricOut);
          p.free(fontOut);
        }
      },
    });
  }
}
