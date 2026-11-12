// SPDX-License-Identifier: MPL-2.0
// Minimal authored DOM for the existing native modal's ownership and controls.
export function nativeWindowDOM() {
  const original = globalThis.document;
  class Node extends EventTarget {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.children = [];
      this.value = '';
      this.style = {};
      this.open = false;
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        node.previousElementSibling = this.children.at(-1);
        this.children.push(node);
      }
    }
    prepend(node) {
      node.parent = this;
      this.children.unshift(node);
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    get firstChild() {
      return this.children[0];
    }
    get firstElementChild() {
      return this.children[0];
    }
    checkValidity() {
      return true;
    }
    focus() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
    }
  }
  const document = {
    hasFocus: () => true,
    createElement: (tag) => new Node(tag),
    body: new Node('body'),
  };
  globalThis.document = document;
  const descendants = (node) => [node, ...node.children.flatMap(descendants)];
  return {
    document,
    all: () => descendants(document.body),
    dispose: () => {
      if (original === undefined) delete globalThis.document;
      else globalThis.document = original;
    },
  };
}
