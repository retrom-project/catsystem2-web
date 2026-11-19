// SPDX-License-Identifier: MPL-2.0
import { HG3 } from '../formats/hg3.mjs';

globalThis.onmessage = async ({ data }) => {
  try {
    const { bytes, remaining } = data,
      image = new HG3(bytes),
      frame = image.frames[0],
      part = frame?.sections.get('img0000');
    if (
      image.frames.length !== 1 ||
      !part ||
      frame.id !== 0 ||
      frame.bpp !== 32 ||
      frame.width * frame.height * 4 > Math.min(8 * 1024 * 1024, remaining)
    ) {
      globalThis.postMessage(null);
      return;
    }
    const b = image.binary,
      at = part.at;
    if (
      [...frame.sections.keys()].filter((tag) => /^img\d+$/.test(tag)).length !== 1 ||
      frame.sections.has('img_jpg') ||
      frame.sections.has('img_wbp') ||
      part.size < 24 ||
      b.u32(at) !== 0 ||
      b.u32(at + 4) !== frame.height ||
      b.u32(at + 12) + b.u32(at + 20) > 16 * 1024 * 1024
    ) {
      globalThis.postMessage(null);
      return;
    }
    await image.decode(frame);
    const { width, height, rgba } = frame;
    globalThis.postMessage({ width, height, rgba }, [rgba.buffer]);
  } catch {
    globalThis.postMessage(null);
  }
};
