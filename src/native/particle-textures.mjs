// SPDX-License-Identifier: MPL-2.0
// The particle loader's image decode, texture upload and focal setup are
// independent of its script/DLL instantiation and graph registration.
import { bitsFloat, encodeCP932, floatBits } from '../kcs.mjs';

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    load: 0x5f58f0,
    begin: 0x5f592b,
    image: 0x5f5b2f,
    imageEnd: 0x5f5cd4,
    focal: 0x5f5de5,
    focalEnd: 0x5f5e11,
    success: 0x5f5e77,
    release: 0x5f4f10,
  },
  'sdk-4.01-engine-2.6.1.74': {
    load: 0x4d01a0,
    begin: 0x4d01c7,
    image: 0x4d03bf,
    imageEnd: 0x4d0527,
    focal: 0x4d0645,
    focalEnd: 0x4d0671,
    success: 0x4d06d7,
    release: 0x4cf7c0,
  },
};

export class NativeParticleTextures {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    this.task = 0;
    this.layout = layouts[engine.profile];
    if (!this.layout) throw new Error('Unknown original particle texture layout');
    const p = this.process,
      l = this.layout,
      reg = (name) => p.cpu.reg_read_i32(p.uc['X86_REG_' + name]) >>> 0,
      set = (name, value) => p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
    const boundary = (address, name, redirect) =>
      p.beforeInstruction(address, 'particle texture ' + name, () => {
        if (this.task && reg('EDI') === this.task) set('EIP', redirect());
      });
    if (
      p.read(l.begin, 1)[0] !== 0xe8 ||
      p.read(l.imageEnd, 1)[0] !== 0x6b ||
      p.read(l.focalEnd, 1)[0] !== 0xe8 ||
      p.read(l.success, 1)[0] !== 0xb8
    )
      throw new Error('Original particle texture entry points differ');
    this.detachers = [
      boundary(l.begin, 'loader setup', () => l.image),
      boundary(l.imageEnd, 'image complete', () => (p.load(this.task + 876) ? l.success : l.focal)),
      boundary(l.focalEnd, 'focal complete', () => {
        // The original focal block has pushed the sort-array allocation
        // arguments. The texture-only call owns no particle arrays.
        set('ESP', reg('ESP') + 8);
        return l.success;
      }),
    ];
    engine.registerFeature('particle-textures', this);
  }
  get d3d() {
    const renderer = this.engine.features.get('renderer');
    if (!renderer?.initialized)
      throw new Error('Particle textures require the shared native device');
    return renderer.d3d;
  }
  object(pointer) {
    const object = this.d3d.objects.get(pointer);
    if (object?.kind !== 'Texture9' || object.references < 1)
      throw new Error('Particle texture has no live original Texture9');
    return object;
  }
  frame(pointer) {
    this.object(pointer);
    return this.d3d.frame(pointer);
  }
  release(pointer) {
    this.d3d.release(this.object(pointer));
  }
  call(address, task) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, [], task)
      : this.engine.call(address, [], task);
  }
  async load({ texture, priority, externalDraw }, previous) {
    const filename = texture instanceof Uint8Array ? texture : encodeCP932((texture ?? '') + '\0');
    if (filename.length > 128 || !filename.includes(0))
      throw new RangeError('Original particle texture name does not fit its 128 byte field');
    if (filename[0] && !externalDraw) {
      const graphics = await this.world.getNativeFeature('graphics-platform');
      await graphics.ensureRenderer();
      await this.world.getNativeFeature('engine-files');
    }
    if (this.task) throw new Error('A native particle texture load is already active');
    const p = this.process,
      task = p.allocate(0x560, true);
    let pointer = 0,
      atlas,
      failure;
    this.task = task;
    try {
      p.write(task + 260, filename);
      p.store(task + 392, floatBits(priority));
      p.store(task + 876, Number(Boolean(externalDraw)));
      for (const [offset, key] of [
        [816, 'width'],
        [820, 'height'],
        [824, 'priority'],
        [828, 'near'],
      ])
        p.store(task + offset, floatBits(previous?.[key] ?? 0));
      if ((await this.call(this.layout.load, task)) !== 1)
        throw new Error('Original particle texture loader did not complete');
      const wrapper = p.load(task + 120),
        descriptor = wrapper && p.load(wrapper);
      if (descriptor) {
        // 672F60 / 549D80 bind the Texture9 at descriptor+20.
        const texture = p.load(descriptor + 20);
        this.d3d.retain(this.object(texture));
        pointer = texture;
      }
      atlas = {
        pointer,
        width: bitsFloat(p.load(task + 816)),
        height: bitsFloat(p.load(task + 820)),
        priority: bitsFloat(p.load(task + 824)),
        near: bitsFloat(p.load(task + 828)),
      };
    } catch (error) {
      failure = error;
    }
    try {
      // The temporary owner has no graph to remove. The original release
      // still destroys both wrappers and releases their COM reference.
      p.store(task + 876, 1);
      await this.call(this.layout.release, task);
    } catch (error) {
      if (failure) failure.cleanup = error;
      else failure = error;
    } finally {
      this.task = 0;
      p.free(task);
    }
    if (failure) {
      if (pointer) this.release(pointer);
      throw failure;
    }
    return atlas;
  }
  snapshot() {
    if (this.task) throw new Error('Cannot checkpoint a loading native particle texture');
    return null;
  }
  restore() {}
  close() {
    for (const detach of this.detachers) detach();
  }
}
