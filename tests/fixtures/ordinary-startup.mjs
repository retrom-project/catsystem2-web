// SPDX-License-Identifier: MPL-2.0
// Authored CPU-entry fixture. These environment adapters do not validate pixels,
// WebGL availability or a device ready/lost lifecycle.
import { GameFiles, BlobFile } from '../../src/files.mjs';
import { NativeFileStorage } from '../../src/native/storage.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { kif, kcsProgram } from '../helpers.mjs';

export const startupProfiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];

function createGL() {
  let next = 1,
    vertexArray = null;
  const constants = new Map(),
    handles = new Map(),
    state = new WeakMap(),
    bindings = new Map(),
    pixelStore = new Map(),
    create = (kind, data = {}) => {
      const handle = { fixtureHandle: next++, kind };
      if (!handles.has(kind)) handles.set(kind, new Set());
      handles.get(kind).add(handle);
      state.set(handle, data);
      return handle;
    },
    live = (kind, handle) => handles.get(kind)?.has(handle) === true,
    require = (kind, handle) => {
      if (!live(kind, handle)) throw new Error(`Invalid fixture ${kind} handle`);
      return state.get(handle);
    },
    defaultVertexArray = { element: null, attributes: new Map() },
    currentVertexArray = () =>
      vertexArray === null ? defaultVertexArray : require('VertexArray', vertexArray),
    attribute = (index) => {
      if (!Number.isInteger(index) || index < 0) throw new Error('Invalid fixture attribute index');
      const attributes = currentVertexArray().attributes;
      if (!attributes.has(index))
        attributes.set(index, {
          enabled: false,
          buffer: null,
          size: 4,
          type: gl.FLOAT,
          normalized: false,
          stride: 0,
          offset: 0,
        });
      return attributes.get(index);
    },
    bound = (kind, target) =>
      require(kind, kind === 'Buffer' && target === gl.ELEMENT_ARRAY_BUFFER
        ? currentVertexArray().element
        : bindings.get(target)),
    reflectUniforms = (shaders) => {
      const uniforms = new Map(),
        types = {
          float: gl.FLOAT,
          int: gl.INT,
          uint: gl.UNSIGNED_INT,
          bool: gl.BOOL,
          sampler2D: gl.SAMPLER_2D,
          vec2: gl.FLOAT_VEC2,
          vec3: gl.FLOAT_VEC3,
          vec4: gl.FLOAT_VEC4,
          ivec2: gl.INT_VEC2,
          ivec3: gl.INT_VEC3,
          ivec4: gl.INT_VEC4,
          mat4: gl.FLOAT_MAT4,
        };
      for (const shader of shaders)
        for (const [, typeName, name, count] of state
          .get(shader)
          .source.matchAll(/uniform\s+(\w+)\s+(\w+)(?:\s*\[\s*(\d+)\s*\])?\s*;/g)) {
          if (!Object.hasOwn(types, typeName))
            throw new Error('Unimplemented fixture uniform type ' + typeName);
          const size = count === undefined ? 1 : Number(count),
            info = { name: count === undefined ? name : name + '[0]', size, type: types[typeName] };
          const previous = uniforms.get(name);
          if (previous && (previous.info.type !== info.type || previous.info.size !== size))
            throw new Error('Conflicting fixture uniform declarations');
          if (!previous) uniforms.set(name, { info });
        }
      return uniforms;
    },
    result = {
      getExtension: () => null,
      getParameter(key) {
        if (key === gl.MAX_TEXTURE_SIZE) return 4096;
        if (key === gl.CURRENT_PROGRAM) return bindings.get(gl.CURRENT_PROGRAM) ?? null;
        if (key === gl.VERTEX_ARRAY_BINDING) return vertexArray;
        if (key === gl.ARRAY_BUFFER_BINDING) return bindings.get(gl.ARRAY_BUFFER) ?? null;
        if (key === gl.ELEMENT_ARRAY_BUFFER_BINDING) return currentVertexArray().element;
        if (key === gl.FRAMEBUFFER_BINDING || key === gl.DRAW_FRAMEBUFFER_BINDING)
          return bindings.get(gl.DRAW_FRAMEBUFFER) ?? bindings.get(gl.FRAMEBUFFER) ?? null;
        if (key === gl.READ_FRAMEBUFFER_BINDING) return bindings.get(gl.READ_FRAMEBUFFER) ?? null;
        throw new Error(`Unexpected fixture WebGL parameter ${key}`);
      },
      isContextLost: () => false,
      createShader: (type) => create('Shader', { type }),
      shaderSource(shader, source) {
        if (typeof source !== 'string' || !source.length)
          throw new Error('Fixture shader source is empty');
        require('Shader', shader).source = source;
      },
      compileShader(shader) {
        const data = require('Shader', shader);
        data.compiled = !!data.source;
      },
      getShaderParameter(shader, name) {
        if (name !== gl.COMPILE_STATUS) throw new Error('Unexpected fixture shader query');
        return require('Shader', shader).compiled === true;
      },
      createProgram: () => create('Program', { shaders: [] }),
      attachShader(program, shader) {
        require('Shader', shader);
        require('Program', program).shaders.push(shader);
      },
      linkProgram(program) {
        const data = require('Program', program);
        data.linked = data.shaders.length === 2 && data.shaders.every((s) => state.get(s).compiled);
        data.uniforms = data.linked ? reflectUniforms(data.shaders) : new Map();
      },
      getProgramParameter(program, name) {
        const data = require('Program', program);
        if (name === gl.LINK_STATUS) return data.linked === true;
        if (name === gl.ACTIVE_UNIFORMS) {
          if (!data.linked) throw new Error('Fixture program is unlinked');
          return data.uniforms.size;
        }
        throw new Error('Unexpected fixture program query');
      },
      getActiveUniform(program, index) {
        const data = require('Program', program);
        if (!data.linked || !Number.isInteger(index) || index < 0 || index >= data.uniforms.size)
          throw new Error('Invalid fixture active uniform index');
        return { ...[...data.uniforms.values()][index].info };
      },
      useProgram(program) {
        if (program !== null && !require('Program', program).linked)
          throw new Error('Fixture program is unlinked');
        bindings.set(gl.CURRENT_PROGRAM, program);
      },
      getUniformLocation(program, name) {
        const data = require('Program', program);
        if (!data.linked) throw new Error('Fixture program is unlinked');
        const uniform = data.uniforms.get(name.replace(/\[0\]$/, ''));
        if (!uniform) return null;
        return (uniform.location ??= { program, name: uniform.info.name });
      },
      bindVertexArray(handle) {
        if (handle !== null) require('VertexArray', handle);
        vertexArray = handle;
      },
      enableVertexAttribArray(index) {
        attribute(index).enabled = true;
      },
      vertexAttribPointer(index, size, type, normalized, stride, offset) {
        const buffer = bindings.get(gl.ARRAY_BUFFER);
        require('Buffer', buffer);
        if (
          type !== gl.FLOAT ||
          !Number.isInteger(size) ||
          size < 1 ||
          size > 4 ||
          !Number.isInteger(stride) ||
          stride < 0 ||
          !Number.isInteger(offset) ||
          offset < 0
        )
          throw new Error('Unimplemented or invalid fixture vertex attribute layout');
        Object.assign(attribute(index), {
          buffer,
          size,
          type,
          normalized: Boolean(normalized),
          stride,
          offset,
        });
      },
      bindBuffer(target, buffer) {
        if (buffer !== null) require('Buffer', buffer);
        if (target === gl.ELEMENT_ARRAY_BUFFER) currentVertexArray().element = buffer;
        else bindings.set(target, buffer);
      },
      bufferData(target, data) {
        const buffer = bound('Buffer', target);
        if (typeof data === 'number') {
          if (!Number.isInteger(data) || data < 0) throw new Error('Invalid fixture buffer size');
          buffer.bytes = new Uint8Array(data);
        } else {
          if (!ArrayBuffer.isView(data)) throw new Error('Invalid fixture buffer source');
          buffer.bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
        }
      },
      bindTexture(target, texture) {
        if (texture !== null) require('Texture', texture);
        bindings.set(target, texture);
      },
      texImage2D(target, _level, _internalFormat, width, height, _border, _format, _type, source) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
          throw new Error('Invalid fixture texture storage');
        const rgba = new Uint8Array(width * height * 4);
        if (source != null) {
          if (!ArrayBuffer.isView(source) || source.byteLength !== rgba.length)
            throw new Error('Invalid fixture texture source');
          rgba.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
        }
        Object.assign(bound('Texture', target), { width, height, rgba });
      },
      texSubImage2D(target, _level, x, y, width, height, _format, _type, source, offset = 0) {
        const texture = bound('Texture', target);
        if (x < 0 || y < 0 || x + width > texture.width || y + height > texture.height)
          throw new Error('Fixture texture upload exceeds storage');
        if (!ArrayBuffer.isView(source)) throw new Error('Invalid fixture upload source');
        const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
          stride = (pixelStore.get(gl.UNPACK_ROW_LENGTH) || width) * 4;
        if (offset < 0 || offset + (height - 1) * stride + width * 4 > bytes.length)
          throw new Error('Fixture upload source exceeds storage');
        for (let row = 0; row < height; row++)
          texture.rgba.set(
            bytes.subarray(offset + row * stride, offset + row * stride + width * 4),
            ((y + row) * texture.width + x) * 4,
          );
      },
      pixelStorei: (name, value) => pixelStore.set(name, value),
      bindFramebuffer(target, framebuffer) {
        if (framebuffer !== null) require('Framebuffer', framebuffer);
        bindings.set(target, framebuffer);
        if (target === gl.FRAMEBUFFER) {
          bindings.set(gl.DRAW_FRAMEBUFFER, framebuffer);
          bindings.set(gl.READ_FRAMEBUFFER, framebuffer);
        } else if (target === gl.DRAW_FRAMEBUFFER) bindings.set(gl.FRAMEBUFFER, framebuffer);
      },
      framebufferTexture2D(target, attachment, _textureTarget, texture) {
        if (texture !== null) require('Texture', texture);
        bound('Framebuffer', target).attachments.set(attachment, texture);
      },
      bindRenderbuffer(target, renderbuffer) {
        if (renderbuffer !== null) require('Renderbuffer', renderbuffer);
        bindings.set(target, renderbuffer);
      },
      renderbufferStorage(target, _format, width, height) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
          throw new Error('Invalid fixture renderbuffer storage');
        Object.assign(bound('Renderbuffer', target), { width, height });
      },
      framebufferRenderbuffer(target, attachment, _renderbufferTarget, renderbuffer) {
        if (renderbuffer !== null) require('Renderbuffer', renderbuffer);
        bound('Framebuffer', target).attachments.set(attachment, renderbuffer);
      },
      checkFramebufferStatus(target) {
        const attachments = bound('Framebuffer', target).attachments,
          color = attachments.get(gl.COLOR_ATTACHMENT0);
        if (!live('Texture', color) || !state.get(color).width)
          return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        const storage = state.get(color);
        for (const handle of attachments.values()) {
          if (handle === null) continue;
          if (!live(handle.kind, handle)) return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
          const data = state.get(handle);
          if (data.width !== storage.width || data.height !== storage.height)
            return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        }
        return gl.FRAMEBUFFER_COMPLETE;
      },
      // CPU storage read-back only; this is not a GPU raster/pixel oracle.
      readPixels(x, y, width, height, _format, _type, output) {
        const framebuffer = bound('Framebuffer', gl.READ_FRAMEBUFFER),
          texture = require('Texture', framebuffer.attachments.get(gl.COLOR_ATTACHMENT0));
        if (
          x < 0 ||
          y < 0 ||
          x + width > texture.width ||
          y + height > texture.height ||
          !ArrayBuffer.isView(output) ||
          output.byteLength < width * height * 4
        )
          throw new Error('Fixture read-back exceeds storage');
        const bytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
        for (let row = 0; row < height; row++) {
          const start = ((y + row) * texture.width + x) * 4;
          bytes.set(texture.rgba.subarray(start, start + width * 4), row * width * 4);
        }
      },
    };
  for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'VertexArray'])
    result[`create${kind}`] = () =>
      create(
        kind,
        kind === 'Framebuffer'
          ? { attachments: new Map() }
          : kind === 'VertexArray'
            ? { element: null, attributes: new Map() }
            : {},
      );
  for (const kind of [
    'Shader',
    'Program',
    'Buffer',
    'Texture',
    'Framebuffer',
    'Renderbuffer',
    'VertexArray',
  ]) {
    result[`is${kind}`] = (handle) => live(kind, handle);
    result[`delete${kind}`] = (handle) => {
      if (kind === 'VertexArray' && vertexArray === handle) vertexArray = null;
      return handles.get(kind)?.delete(handle);
    };
  }
  for (const name of ['uniform1i', 'uniform2f', 'viewport', 'enable', 'blendFunc', 'texParameteri'])
    result[name] = () => {};
  const gl = new Proxy(result, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, next++);
        return constants.get(key);
      }
      throw new Error(`Unexpected fixture WebGL operation ${String(key)}`);
    },
  });
  return gl;
}

export class StartupCanvas extends EventTarget {
  constructor(width = 64, height = 48) {
    super();
    Object.assign(this, { width, height, style: {}, hidden: false });
  }
  getContext(type) {
    if (type === 'webgl2') return (this.gl ??= createGL());
    if (type !== '2d') throw new Error(`Unexpected canvas context ${type}`);
    return (this.context ??= { canvas: this });
  }
}

export function startupEnvironment() {
  const saved = new Map(),
    records = new Map();
  for (const name of ['OffscreenCanvas', 'indexedDB', 'document', 'navigator'])
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, 'OffscreenCanvas', {
    configurable: true,
    value: StartupCanvas,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'en-US' },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      title: '',
      hasFocus: () => true,
      fonts: { add() {}, delete() {} },
    },
  });
  const db = {
    createObjectStore() {},
    close() {},
    transaction() {
      const tx = {},
        action = (execute) => {
          const request = {};
          queueMicrotask(() => {
            request.result = execute();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        };
      tx.objectStore = () => ({
        getAll: () => action(() => [...records.values()].map((record) => structuredClone(record))),
        put: (record) =>
          action(() => {
            records.set(record.key, structuredClone(record));
            return record.key;
          }),
        delete: (key) => action(() => records.delete(key)),
      });
      return tx;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = {};
        queueMicrotask(() => {
          request.result = db;
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      },
    },
  });
  return {
    restore() {
      for (const [name, descriptor] of saved)
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    },
  };
}

export function startupXML(profile, body) {
  const encoding = nativeABI(profile).xmlEncoding,
    text = `<?xml version="1.0" encoding="${encoding}"?><document>${body}</document>`;
  return encoding === 'UTF-8' ? new TextEncoder().encode(text) : encodeCP932(text);
}

export async function ordinaryStartupGame(
  profile,
  { files = {}, startup = '', sound = true, includeOwnedVerificationCode = true } = {},
) {
  // This test fixture authors public APP input, not an inferred engine default.
  // Explicit test code keeps its original bytes; missing-input tests opt out.
  const ownedCode =
      includeOwnedVerificationCode && !/<v_code(?:\s|>)/i.test(startup)
        ? '<v_code>open_cs2</v_code>'
        : '',
    { ['sound.xml']: soundOverride, ...looseFiles } = files,
    mountedSound = Object.hasOwn(files, 'sound.xml')
      ? soundOverride
      : startupXML(
          profile,
          '<MASTER><volume>70</volume><sysplay>1</sysplay><mute>0</mute></MASTER><PART><bgm><head>bgm</head><volume>60</volume></bgm></PART>',
        ),
    entries = {
      'startup.xml': startupXML(
        profile,
        `
      <APP><title>$title$Fallback</title>${ownedCode}</APP>
      <SCREEN><width>64</width><height>48</height><v_width>128</v_width><v_height>96</v_height><fps>60</fps></SCREEN>
      <SCRIPT><start>main.kcs</start></SCRIPT>
      <INT><int00><name>kcs</name><int>scripts.int</int><ext>kcs</ext></int00><int01><name>config</name><int>config.int</int><ext>xml</ext></int01></INT>
      <VOICE><vol><master>80</master><bgm>50</bgm></vol></VOICE>
      <language><default>0</default><L00><code>1033</code><prefix>en</prefix><lang>English</lang></L00></language>
      ${sound ? '<SOUNDCONFIG>sound.xml</SOUNDCONFIG>' : ''}${startup}`,
      ),
      'config.int': kif([
        [
          'gamedef.xml',
          startupXML(profile, '<VOICE><vol_master>80</vol_master><vol_bgm>50</vol_bgm></VOICE>'),
        ],
        ...(sound && mountedSound !== undefined ? [['sound.xml', mountedSound]] : []),
      ]),
      'scripts.int': kif([
        [
          'main.kcs',
          kcsProgram([
            [37, 64],
            [43, 0xd1, 4],
            [37, 7],
            [37, 0x12345678],
            [43, 0xd3, 8],
            [43, 0x41, 0],
            [59],
          ]),
        ],
      ]),
      'language.txt': encodeCP932('$title$\r\nAuthored SDK title\r\n'),
      'language_en.txt': new TextEncoder().encode('$title$\r\nAuthored game title\r\n'),
      ...looseFiles,
    },
    game = new GameFiles(
      new Map(
        Object.entries(entries)
          .filter(([, bytes]) => bytes !== undefined)
          .map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
      ),
    );
  await game.open();
  return game;
}

export async function saveStartupPreferences(game, entries) {
  const storage = new NativeFileStorage(game, await game.fingerprint());
  await storage.open();
  try {
    for (const [file, bytes] of Object.entries(entries)) await storage.write(file, bytes);
  } finally {
    storage.close();
  }
}

// Authored PE metadata with no executable code. The resource tree contains
// only public fixture bytes and a fixed version record for ABI selection.
export function startupVersionImage(version, resources = []) {
  const bytes = new Uint8Array(8192),
    view = new DataView(bytes.buffer),
    u16 = (at, value) => view.setUint16(at, value, true),
    u32 = (at, value) => view.setUint32(at, value, true),
    base = 512,
    fixed = new Uint8Array(92),
    fixedView = new DataView(fixed.buffer);
  fixedView.setUint16(0, 92, true);
  fixedView.setUint16(2, 52, true);
  Array.from('VS_VERSION_INFO').forEach((c, i) =>
    fixedView.setUint16(6 + i * 2, c.charCodeAt(0), true),
  );
  fixedView.setUint32(40, 0xfeef04bd, true);
  fixedView.setUint32(44, 0x10000, true);
  const [a, b, c, d] = version.split('.').map(Number);
  fixedView.setUint32(48, (a << 16) | b, true);
  fixedView.setUint32(52, (c << 16) | d, true);
  const root = { children: [] },
    add = (parent, key) => {
      let child = parent.children.find((node) => node.key === key);
      if (!child) {
        child = { key, children: [] };
        parent.children.push(child);
      }
      return child;
    };
  for (const resource of [...resources, { type: 16, name: 1, bytes: fixed }]) {
    const node = add(add(root, resource.type), resource.name);
    node.children.push({ key: 1041, bytes: resource.bytes, dataRVA: resource.dataRVA });
  }
  let cursor = 0;
  const allocate = (size) => {
      const offset = cursor;
      cursor = (cursor + size + 3) & ~3;
      return offset;
    },
    write = (node) => {
      const offset = allocate(16 + node.children.length * 8),
        named = node.children.filter((child) => typeof child.key === 'string'),
        numbered = node.children.filter((child) => typeof child.key === 'number');
      u16(base + offset + 12, named.length);
      u16(base + offset + 14, numbered.length);
      [...named, ...numbered].forEach((child, i) => {
        const at = base + offset + 16 + i * 8;
        let key = child.key;
        if (typeof key === 'string') {
          const start = allocate(2 + key.length * 2);
          u16(base + start, key.length);
          Array.from(key).forEach((ch, n) => u16(base + start + 2 + n * 2, ch.charCodeAt(0)));
          key = (start | 0x80000000) >>> 0;
        }
        u32(at, key);
        if (child.children) u32(at + 4, (write(child) | 0x80000000) >>> 0);
        else {
          const data = allocate(16),
            payload = allocate(child.bytes.length);
          u32(at + 4, data);
          u32(base + data, child.dataRVA ?? 4096 + payload);
          u32(base + data + 4, child.bytes.length);
          bytes.set(child.bytes, base + payload);
        }
      });
      return offset;
    };
  write(root);
  bytes.set([77, 90]);
  u32(60, 128);
  bytes.set([80, 69, 0, 0], 128);
  u16(134, 1);
  u16(148, 224);
  u16(152, 0x10b);
  u32(264, 4096);
  u32(268, cursor);
  u32(384, bytes.length - base);
  u32(388, 4096);
  u32(392, bytes.length - base);
  u32(396, base);
  return bytes;
}
