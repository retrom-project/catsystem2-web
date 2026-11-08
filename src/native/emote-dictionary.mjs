// SPDX-License-Identifier: MPL-2.0
// Read-only std::map<string,uint32> view consumed by main M2 map natives.
// No C++ mutation or ownership operation is permitted on this temporary view.
export class NativeEmoteDictionary {
  constructor(process, dictionary) {
    this.process = process;
    this.owned = [];
    const alloc = (size) => {
        const pointer = process.allocate(size, true);
        this.owned.push(pointer);
        return pointer;
      },
      entries = dictionary.ordered(),
      head = alloc(44),
      nodes = entries.map(() => alloc(44));
    this.pointer = alloc(8);
    process.store(this.pointer, head);
    process.store(this.pointer + 4, nodes.length);
    process.write(head + 12, [1, 1]);
    process.store(head, nodes[0] ?? head);
    process.store(head + 8, nodes.at(-1) ?? head);
    const tree = (first, last, parent) => {
      if (first >= last) return head;
      const middle = (first + last) >>> 1,
        node = nodes[middle];
      process.store(node, tree(first, middle, node));
      process.store(node + 4, parent);
      process.store(node + 8, tree(middle + 1, last, node));
      process.write(node + 12, [1, 0]);
      return node;
    };
    process.store(head + 4, tree(0, nodes.length, head));
    entries.forEach(({ key, value }, index) => {
      const node = nodes[index],
        data = key.length < 16 ? node + 16 : alloc(key.length + 1);
      if (key.length >= 16) process.store(node + 16, data);
      process.write(data, key);
      process.zero(data + key.length, 1);
      process.store(node + 32, key.length);
      process.store(node + 36, key.length < 16 ? 15 : key.length);
      process.store(node + 40, value);
    });
  }
  close() {
    for (const pointer of this.owned.reverse()) this.process.free(pointer);
    this.owned = [];
  }
}
