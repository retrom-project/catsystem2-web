// SPDX-License-Identifier: MPL-2.0
// Lossless checkpoint bytes. Allocation length is observable; omitted blocks
// restore as zero without retaining an oversized source view's backing buffer.
const MAX_BYTES = 0x40000000;
function checkLength(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BYTES)
    throw new RangeError('Sparse byte length exceeds its allocation range');
}
function checkBlockSize(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024 * 1024)
    throw new RangeError('Invalid sparse byte block size');
}
export function encodeSparseBytes(source, { blockSize = 32768 } = {}) {
  checkBlockSize(blockSize);
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : ArrayBuffer.isView(source)
        ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
        : null;
  if (!bytes) throw new TypeError('Sparse checkpoint source requires binary bytes');
  checkLength(bytes.length);
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const block = bytes.subarray(offset, Math.min(bytes.length, offset + blockSize));
    if (block.some((value) => value !== 0)) blocks.push({ offset, bytes: block.slice() });
  }
  return { length: bytes.length, blockSize, blocks };
}
export function decodeSparseBytes(state) {
  if (!state || typeof state !== 'object') throw new TypeError('Invalid sparse byte checkpoint');
  checkLength(state.length);
  checkBlockSize(state.blockSize);
  if (!Array.isArray(state.blocks)) throw new TypeError('Sparse byte blocks require an array');
  let previous = -1;
  for (const block of state.blocks) {
    if (
      !block ||
      !Number.isSafeInteger(block.offset) ||
      block.offset < 0 ||
      block.offset <= previous ||
      block.offset % state.blockSize !== 0 ||
      !(block.bytes instanceof Uint8Array) ||
      block.bytes.length !== Math.min(state.blockSize, state.length - block.offset) ||
      block.offset + block.bytes.length > state.length ||
      !block.bytes.length
    )
      throw new RangeError('Sparse byte blocks are unordered or outside their allocation');
    previous = block.offset;
  }
  const bytes = new Uint8Array(state.length);
  for (const block of state.blocks) bytes.set(block.bytes, block.offset);
  return bytes;
}
