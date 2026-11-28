// SPDX-License-Identifier: MPL-2.0
// Owned JS text objects; no process, traps, Win32 imports or executable state.
export class NativeTextObjects {
  constructor({ glyphs, fontFamilies = () => [] } = {}) {
    Object.assign(this, { glyphs, fontFamilies });
    this.objects = new Map();
    this.nextObject = 0x60000000;
  }
  createObject(kind, values) {
    const handle = this.nextObject++;
    this.objects.set(handle, { kind, ...values });
    return handle;
  }
  object(handle, kind) {
    const object = this.objects.get(handle);
    if (!object || (kind && object.kind !== kind))
      throw new Error(`Invalid native text GDI ${kind || 'object'} ${handle}`);
    return object;
  }
  font(dc) {
    const id = this.object(dc, 'dc').font;
    return id
      ? this.object(id, 'font')
      : { face: 'sans-serif', height: -16, width: 0, weight: 400, escapement: 0, orientation: 0 };
  }
  snapshot() {
    return { nextObject: this.nextObject, objects: structuredClone([...this.objects]) };
  }
  restore(state) {
    this.nextObject = state.nextObject;
    this.objects = new Map(structuredClone(state.objects));
  }
}
