// SPDX-License-Identifier: MPL-2.0
// Browser clipboard ownership is local; writes report actual platform success.
export class BrowserNativeClipboard {
  constructor({ clipboard = globalThis.navigator?.clipboard, diagnostic = () => {} } = {}) {
    this.clipboard = clipboard;
    this.diagnostic = diagnostic;
    this.opened = false;
  }
  open(owner) {
    if (this.opened || typeof this.clipboard?.writeText !== 'function') return false;
    this.owner = owner >>> 0;
    this.opened = true;
    return true;
  }
  empty() {
    return this.write('');
  }
  async write(text) {
    if (!this.opened) return false;
    try {
      await this.clipboard.writeText(text);
      return true;
    } catch (error) {
      this.diagnostic({ type: 'native-clipboard', message: error.message });
      return false;
    }
  }
  close() {
    const opened = this.opened;
    this.opened = false;
    this.owner = null;
    return opened;
  }
}
