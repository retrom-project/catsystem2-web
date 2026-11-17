// SPDX-License-Identifier: MPL-2.0
export class NativeCOMTaskMemory {
  constructor(kernel) {
    this.process = kernel.process;
    this.blocks = new Set();
    kernel.register('OLE32.dll', 'CoTaskMemAlloc', {
      count: 1,
      fn: ([size]) => this.allocate(size),
    });
    kernel.register('OLE32.dll', 'CoTaskMemFree', {
      count: 1,
      fn: ([pointer]) => this.free(pointer),
    });
  }
  allocate(size) {
    let pointer;
    try {
      pointer = this.process.allocate(size);
    } catch (error) {
      if (error.message !== 'PE32 heap exhausted') throw error;
      return 0;
    }
    this.blocks.add(pointer);
    return pointer;
  }
  free(pointer) {
    if (!pointer) return;
    if (!this.blocks.has(pointer) || !this.process.free(pointer))
      throw new Error('CoTaskMemFree received a pointer outside COM task memory');
    this.blocks.delete(pointer);
  }
  snapshot() {
    return [...this.blocks];
  }
  restore(pointers) {
    const blocks = new Set(pointers);
    if (
      blocks.size !== pointers.length ||
      [...blocks].some((pointer) => !this.process.allocations.has(pointer))
    )
      throw new Error('Invalid COM task memory checkpoint');
    this.blocks = blocks;
  }
}
