// SPDX-License-Identifier: MPL-2.0
// File selection and decoded inputs belong to JS; ANM execution belongs to Draw.
import { encodeCP932 } from '../kcs/strings.mjs';
import { parseNativeResourceSelection } from './resource-selection.mjs';
import { nativeImagePathParts } from './image-file.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { nativeABI } from './abi/index.mjs';
import { HG3 } from '../formats/hg3.mjs';

const decode = (bytes) => new TextDecoder('shift_jis').decode(bytes);
export async function loadImageOwner(owners, name, task, { describeLayers = false } = {}) {
  const world = owners.world,
    files = world.imageFiles,
    images = world.graphics.images;
  const resolved = files.resolve(name);
  if (!resolved) return 0;
  const { stem, extension } = nativeImagePathParts(resolved);
  const selection = parseNativeResourceSelection(encodeCP932(stem));
  if (!selection) return 0;
  const base = decode(selection.base),
    layers = [];
  const append = (layer) => {
    if (layer) layers.push({ key: layers.length, ...layer });
  };
  const staticLayer = async (file) => {
    const parts = nativeImagePathParts(file),
      match = /^(.*):([+-]?\d+)$/.exec(parts.stem);
    const bitmap = match
      ? await images.load(match[1] + parts.extension, Number(match[2]) >>> 0)
      : await world.imageComposites.load(file);
    append(bitmap ? { bitmap, program: null, ...(describeLayers ? { name: file } : {}) } : null);
  };
  const animatedLayer = async (file) => {
    const bytes = await files.read(file);
    if (!bytes?.length) return;
    const out = new Uint8Array(36);
    let bounds = {
      offsetX: 0,
      offsetY: 0,
      width: 0,
      height: 0,
      canvasWidth: 0,
      canvasHeight: 0,
      baseX: 0,
      baseY: 0,
    };
    try {
      if (nativeImageMetadata(bytes, 0, true, out).success) {
        const v = new DataView(out.buffer);
        ['offsetX', 'offsetY', 'width', 'height', 'canvasWidth', 'canvasHeight'].forEach(
          (k, i) => (bounds[k] = v.getInt32(i * 4, true)),
        );
      }
    } catch {
      /* A readable file can still create an empty animated source. */
    }
    const frames = [];
    try {
      const image = await images.images.load(file);
      const candidates = nativeABI(world.profile).graphics.preserveRGB24
        ? image.frames
        : image instanceof HG3
          ? image.frames
          : image.frames.slice(0, 1);
      for (const frame of candidates) {
        if (frames.some((f) => f.key === frame.id >>> 0)) continue;
        let bitmap = 0;
        try {
          await image.decode(frame);
          bitmap = images.addDecoded(image, frame);
        } catch {
          if (nativeABI(world.profile).graphics.preserveRGB24) break;
        }
        frames.push({ key: frame.id >>> 0, bitmap });
      }
    } catch {
      /* The original object retains the failed frame map. */
    }
    frames.sort((a, b) => a.key - b.key);
    const selected = frames[0]?.key ?? 0,
      current = frames[0]?.bitmap;
    if (current) {
      const s = images.get(current).state;
      bounds.baseX = s.baseX;
      bounds.baseY = s.baseY;
    }
    const programFile = await files.locate(file),
      program = programFile && (await files.readResolved(programFile));
    append({
      bitmap: 0,
      ...(describeLayers ? { name: file } : {}),
      program: program?.length ? program : null,
      animation: { frames, selected, bounds },
    });
  };
  try {
    if (!selection.selectors.length) {
      if (await files.locate(resolved)) await animatedLayer(resolved);
      else await staticLayer(resolved);
    } else {
      let group = base,
        previousANM = false,
        pending = false,
        previousCandidate = '';
      for (let i = 0; i < selection.selectors.length; i++) {
        const selector = selection.selectors[i];
        if (selector === 48) {
          group += ',0';
          continue;
        }
        if (!selector) continue;
        const suffix = decode(
          Uint8Array.of(selector, selector >> 8, selector >> 16).subarray(0, selector < 0 ? 3 : 1),
        );
        const candidate = base + '_' + '0'.repeat(i) + suffix + extension,
          isANM = Boolean(await files.locate(candidate));
        if (isANM) {
          if (previousANM) await animatedLayer(previousCandidate);
          else await staticLayer(group + extension);
          group = base + ',0'.repeat(i) + ',' + suffix;
          previousANM = true;
          pending = false;
        } else if (previousANM) {
          await animatedLayer(previousCandidate);
          group = base + ',0'.repeat(i) + ',' + suffix;
          previousANM = false;
          pending = true;
        } else {
          group += ',' + suffix;
          pending = true;
        }
        previousCandidate = candidate;
      }
      // A trailing ANM candidate is deliberately not flushed by the engine.
      if (pending) await staticLayer(group + extension);
    }
    if (!layers.length) return 0;
    const record = { owner: task.id, bitmap: 0, info: [0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0], layers };
    await owners.rebuild(record);
    record.info[9] = selection.selectors.length ? 1 : 0;
    return world.runtime.handles.add('image-owner', record);
  } catch (error) {
    for (const handle of new Set(
      layers.flatMap((l) => [l.bitmap, ...(l.animation?.frames ?? []).map((f) => f.bitmap)]),
    ))
      if (handle) await images.release(handle);
    throw error;
  }
}
