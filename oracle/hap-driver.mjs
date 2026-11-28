// SPDX-License-Identifier: MPL-2.0
const VID = 0x63646976;
const HAP5 = 0x35706148;
const DRIVERS = {
  'nekopara-vol3-engine-2.6.1.76': 0x8ef07c,
  'sdk-4.01-engine-2.6.1.74': 0x9b135c,
};

export class NativeHapDriver {
  constructor(engine) {
    this.process = engine.process;
    this.vtable = DRIVERS[engine.profile];
    this.path = null;
    engine.registerWindows('MSVFW32.dll', 'ICInstall', {
      count: 5,
      fn: (args) => this.install(...args),
    });
    engine.registerWindows('MSVFW32.dll', 'ICRemove', {
      count: 3,
      fn: (args) => this.remove(...args),
    });
  }
  install(type, handler, path, _description, flags) {
    if (type !== VID || handler !== HAP5 || flags !== 2 || !path) return 0;
    // ICInstall is an ANSI API. The game's UTF-16 pointer supplies only the
    // first character of its path, while the SDK converts the whole string.
    this.path = this.process.string(path);
    return 1;
  }
  remove(type, handler, flags) {
    if (type !== VID || handler !== HAP5 || flags || this.path === null) return 0;
    this.path = null;
    return 1;
  }
  matches(movie) {
    const p = this.process,
      loader = p.load(movie + 424);
    return Boolean(
      this.vtable && p.allocations.get(loader) === 12 && p.load(loader) === this.vtable,
    );
  }
  available() {
    return /(?:^|\/)dsfilter\/hapcodec\.dll$/i.test(this.path?.replaceAll('\\', '/') ?? '');
  }
}
