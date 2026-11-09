// SPDX-License-Identifier: MPL-2.0
// Marshals the reviewed KCS address translator's data/stack/shared/block ABI.
// The original native handler retains its pointer translation and formatter.
export class NativeKCSMemory {
  constructor(process, machine, mapping) {
    this.process = process;
    this.machine = machine;
    this.owned = [];
    this.regions = [];
    if (mapping?.vm) {
      this.pointer = mapping.vm.pointer;
      this.regions = [
        ...(!mapping.memory.live ? [[mapping.memory.pointer, () => machine.memory]] : []),
        ...(!mapping.shared.external && !mapping.shared.live
          ? [[mapping.shared.pointer, () => machine.shared]]
          : []),
        ...machine.blocks.flatMap((bytes, index) =>
          mapping.blocks[index].live
            ? []
            : [[mapping.blocks[index].pointer, () => machine.blockBytes(index)]],
        ),
      ];
      return;
    }
    const allocate = (size) => {
      const pointer = process.allocate(size, true);
      this.owned.push(pointer);
      return pointer;
    };
    this.pointer = allocate(1408);
    const header = machine.script?.header;
    if (header) {
      const pointer = allocate(header.length);
      process.write(pointer, header);
      process.store(this.pointer + 8, pointer);
    }
    const copy = (read, existing) => {
      if (existing?.external || existing?.live) return existing.pointer;
      const bytes = read().slice(),
        pointer = existing?.pointer ?? allocate(bytes.length);
      process.write(pointer, bytes);
      this.regions.push([pointer, read]);
      return pointer;
    };
    process.store(
      this.pointer + 20,
      copy(() => machine.memory, mapping?.memory),
    );
    process.store(this.pointer + 36, machine.memory.length);
    process.store(this.pointer + 32, machine.fp);
    process.store(
      this.pointer + 40,
      copy(() => machine.shared, mapping?.shared),
    );
    process.store(this.pointer + 44, machine.shared.length);
    process.store(this.pointer + 1388, allocate(8192));
    const container = allocate(4),
      head = allocate(16);
    process.store(container, head);
    process.store(this.pointer + 48, container);
    let previous = head;
    for (const [index, bytes] of machine.blocks.entries()) {
      const node = allocate(16);
      process.store(previous, node);
      const id = machine.blockIDs[index],
        read = () => {
          const current = machine.blockIndex(id);
          if (current < 0)
            throw new Error('Native temporary VM bridge source allocation was released');
          return machine.blockBytes(current);
        };
      process.store(node + 8, copy(read, mapping?.blocks[index]));
      process.store(node + 12, bytes.length);
      previous = node;
    }
    process.store(previous, head);
  }
  close() {
    if (this.closed) return;
    const errors = [];
    for (const [pointer, read] of this.regions)
      try {
        const bytes = read(),
          source = this.process.read(pointer, bytes.length);
        // Reading can grow WASM's transfer buffer; reacquire the destination.
        read().set(source);
      } catch (error) {
        errors.push(error);
      }
    for (const pointer of this.owned.reverse())
      if (!this.process.free(pointer))
        errors.push(new Error('Native temporary VM bridge allocation was already released'));
    this.owned = [];
    this.regions = [];
    this.closed = true;
    if (errors.length)
      throw new AggregateError(errors, 'Native temporary VM bridge cleanup failed');
  }
}
