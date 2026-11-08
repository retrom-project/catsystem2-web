// SPDX-License-Identifier: MPL-2.0
// Original FES local bank 728F50/728F70, byte export 728FD0 and import 728FA0.
export function encodeFESLocals(instance) {
  const bytes = new Uint8Array(2048),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < 512; i++) view.setUint32(i * 4, instance.local(i) >>> 0, true);
  return bytes;
}
export function applyFESLocals(instance, bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('FES locals require a byte buffer');
  const copied = Math.min(2048, bytes.length),
    data = encodeFESLocals(instance);
  data.set(bytes.subarray(0, copied));
  const view = new DataView(data.buffer);
  for (let i = 0; i < Math.ceil(copied / 4); i++) instance.setLocal(i, view.getInt32(i * 4, true));
  return copied;
}
