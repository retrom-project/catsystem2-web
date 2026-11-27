// SPDX-License-Identifier: MPL-2.0
import { inflate } from '../binary.mjs';
import { PSB } from '../formats/psb.mjs';
import { EmoteDocument, EMOTE_PREPARATION_LIMITS } from './document.mjs';

export function buildPreparedEmoteAtlas(expanded) {
  if (expanded.length > EMOTE_PREPARATION_LIMITS.atlasWorkingBytes) return null;
  const document = new EmoteDocument(new PSB(expanded, { allowUnverifiedVersion: true }));
  if (document.sources.size !== 1) return null;
  const [name, source] = document.sources.entries().next().value;
  const data = source.texture;
  if (data?.type !== 'RGBA8' || data.compress || !Number.isInteger(data.pixel?.resource))
    return null;
  const width = data.truncated_width ?? data.width,
    height = data.truncated_height ?? data.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    expanded.length + width * height * 4 > EMOTE_PREPARATION_LIMITS.atlasWorkingBytes
  )
    return null;
  return {
    name,
    resource: data.pixel.resource,
    storedWidth: data.width,
    storedHeight: data.height,
    texture: document.texture(name),
  };
}

self.onmessage = async ({ data }) => {
  if (data === 'ready') {
    self.postMessage('ready');
    return;
  }
  try {
    const { bytes, length } = data;
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > EMOTE_PREPARATION_LIMITS.packedBytes ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > EMOTE_PREPARATION_LIMITS.expandedBytes
    )
      throw new Error('E-mote preparation exceeds its byte budget');
    const expanded = await inflate(bytes, length, EMOTE_PREPARATION_LIMITS.expandedBytes);
    let atlas = null;
    try {
      atlas = buildPreparedEmoteAtlas(expanded);
    } catch {
      // A texture error belongs to the real texture request. The PSZ is ready.
    }
    const transfer = [expanded.buffer];
    if (atlas) transfer.push(atlas.texture.rgba.buffer);
    self.postMessage({ expanded, atlas }, transfer);
  } catch {
    self.postMessage(null);
  }
};
