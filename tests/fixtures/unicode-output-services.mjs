// SPDX-License-Identifier: MPL-2.0
export class AuthoredClipboard {
  constructor() {
    this.events = [];
    this.contents = 'previous';
    this.available = true;
    this.acceptEmpty = true;
    this.acceptWrite = true;
    this.opened = false;
  }
  open(owner) {
    this.events.push(['open', owner]);
    if (!this.available || this.opened) return false;
    this.opened = true;
    return true;
  }
  empty() {
    this.events.push(['empty']);
    if (!this.opened || !this.acceptEmpty) return false;
    this.contents = '';
    return true;
  }
  write(text) {
    this.events.push(['write', text]);
    if (!this.opened || !this.acceptWrite) return false;
    this.contents = text;
    return true;
  }
  close() {
    this.events.push(['close']);
    const previous = this.opened;
    this.opened = false;
    return previous;
  }
}
