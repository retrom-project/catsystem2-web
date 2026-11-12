// SPDX-License-Identifier: MPL-2.0
// Bridge to existing D5 JS text state/driver; construction is supplied by the
// integrating FES collection and never calls its old PE object factory.
import { nativeABI } from './abi/index.mjs';
import { FES_TEXT_LAYOUT_MODES } from './fes-text-layout.mjs';
import { textConfig } from './text-config.mjs';
import { markFESObjectDirty } from './fes-common-model.mjs';

export class FESLogTextService {
  constructor({ world, instance, createChild, resolveChild, findChild }) {
    if (
      typeof createChild !== 'function' ||
      typeof resolveChild !== 'function' ||
      typeof findChild !== 'function'
    )
      throw new TypeError(
        'LOG text service needs explicit FES collection create/resolve/find callbacks',
      );
    Object.assign(this, { world, instance, createChild, resolveChild, findChild });
    this.text = world.text.fes;
    this.definition = nativeABI(world.profile);
  }
  child(handle) {
    const child = this.resolveChild(handle);
    if (!child || child.deleted) throw new Error(`Missing generated LOG STRING ${handle}`);
    return child;
  }
  async create(specification) {
    if (specification.nativeType === 37 && !this.definition.capabilities.utf8Text)
      throw new Error('The registered ABI has no STRING8/LOGSTRING8 task implementation');
    const existing = this.findChild(specification.name, 0);
    if (existing && !existing.deleted) return this.child(existing.handle).handle;
    const child = await this.createChild(specification);
    if (!child || child.nativeTaskID == null || child.handle == null)
      throw new Error('Generated LOG STRING requires distinct FES handle and real World text task');
    if (child.parentHandle != null)
      throw new Error('Generated LOG STRING must not acquire a PARENT link to the LOG');
    return child.handle;
  }
  configure(handle, width, height, priority, vramX, vramY) {
    const child = this.child(handle),
      s = this.text.state(child),
      layout = this.text.layout(child);
    child.width = width;
    child.height = height;
    child.pri = priority;
    child.vramX = vramX;
    child.vramY = vramY;
    child.vramZ = 0;
    layout.apply('view', [width, height]);
    s.layout = layout.snapshot();
    s.dirty = true;
    markFESObjectDirty(this.instance, child);
  }
  priority(handle, value) {
    const child = this.child(handle);
    child.pri = value | 0;
    markFESObjectDirty(this.instance, child);
  }
  position(handle, x, y) {
    const child = this.child(handle);
    child.x = Math.fround(x);
    child.y = Math.fround(y);
    child.z = 0;
    markFESObjectDirty(this.instance, child);
  }
  source(handle, bytes) {
    const s = this.text.state(this.child(handle));
    s.source = bytes ? bytes.slice() : new Uint8Array();
    s.pendingClear = s.fullSource = true;
    s.oldLength = 0;
    s.remaining = -1;
  }
  colors(handle, colors) {
    const child = this.child(handle),
      s = this.text.state(child),
      layout = this.text.layout(child);
    for (let index = 0; index < 3; index++) {
      // Both the JS writer config and the FES normal-color cache are updated
      // by the original packed-color setter; layout's cache alone is not cfg.
      layout.word(194 + index, colors[index]);
      layout.word(layout.abi.colors + index, colors[index]);
    }
    s.layout = layout.snapshot();
    s.dirty = true;
  }
  display(handle, value) {
    const child = this.child(handle);
    child.disp = !!value;
    child.displayValue = Number(!!value);
    markFESObjectDirty(this.instance, child);
  }
  draw(handle, page) {
    const s = this.text.state(this.child(handle));
    s.page = page | 0;
    s.pagePending = true;
    s.remaining = 1;
  }
  endY(handle) {
    return this.text.state(this.child(handle)).end[1] | 0;
  }
  consumeEndChanged(handle) {
    const s = this.text.state(this.child(handle)),
      changed = !!s.endChanged;
    s.endChanged = false;
    return changed;
  }
  supportsLayout(mode) {
    return FES_TEXT_LAYOUT_MODES.includes(mode) && this.definition.text.layoutModes.includes(mode);
  }
  layout(handle, mode, args, evaluate) {
    const child = this.child(handle),
      s = this.text.state(child),
      layout = this.text.layout(child),
      defaults = {
        font: this.world.configuration.fields.font.name,
        weight: this.world.configuration.fields.font.weight ? 700 : 400,
        frame: this.world.configuration.blocks[1]
          ? new DataView(this.world.configuration.blocks[1].buffer).getUint32(0, true)
          : 0,
      },
      before = layout.profiles[mode],
      result = layout.apply(mode, args, evaluate, defaults);
    if (result.applied && (mode === 'd_prof' || mode === 'prof') && before)
      layout.profiles[mode].text = before.text + layout.profiles[mode].text;
    s.layout = layout.snapshot();
    return result;
  }
  reset(handle) {
    const child = this.child(handle),
      s = this.text.state(child),
      layout = this.text.layout(child);
    // The existing JS D5 layout owns its serialized text configuration. Only
    // that config is reset, exactly as NativeFESText's reset command does;
    // LOG's semantic state and six palettes are unaffected.
    layout.bytes.set(
      textConfig(
        this.world.profile,
        child.nativeType === 37 ? 'utf8' : 'cp932',
        this.world.configuration,
        { fes: true },
      ),
      764,
    );
    s.layout = layout.snapshot();
    s.dirty = true;
  }
}
