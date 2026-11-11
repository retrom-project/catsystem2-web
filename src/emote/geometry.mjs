// SPDX-License-Identifier: BSD-3-Clause
// Layer, inheritance and mesh algorithms adapted from motionplayer.
// Source/notice details: NOTICE.md and licenses/motionplayer.txt.
import {
  layerContent,
  copyContent,
  interpolateContent,
  localMatrix,
  parameterTime,
  colorProduct,
  colorBilinear,
  identityPatch,
} from './geometry-content.mjs';
import { EmotePatch, patchDivisions } from './mesh.mjs';
const f = Math.fround;
const skipParentTransform = 0x400000; /* exe-address-check: non-address - PSB inheritance flag bypasses the parent transform */
const fields = ['flipX', 'flipY', 'angle', 'scaleX', 'scaleY', 'slantX', 'slantY'];
const flags = [4, 8, 16, 32, 64, 128, 256];

function nodeRecord(layer, group, parent) {
  return {
    layer,
    group,
    parent,
    active: false,
    visible: false,
    frames: (layer.frameList ?? []).map((frame) => ({
      ...frame,
      content: layerContent(frame.content),
    })),
    state: { colors: new Uint32Array(4), patch: new Float32Array(32) },
    matrix: new Float64Array(4),
    scratch: new Float64Array(4),
    colors: new Uint32Array(4),
    corners: new Float32Array(8),
    transformed: new Float32Array(32),
    inverse: new Float32Array(6),
    combined: new Float32Array(32),
    packetSets: new Map(),
    transformState: {},
    children: [],
    motions: new Map(),
    packets: [],
    bindings: new Map(),
    patch: null,
    ancestor: null,
  };
}

class EmotePacket {
  constructor(count) {
    this.count = count - 2;
    this.type = 5;
    this.stride = 24;
    this.fvf = 322;
    this.bytes = new Uint8Array(count * 24);
    this.view = new DataView(this.bytes.buffer);
    this.vertices = Array.from({ length: count }, () => ({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
      color: 0,
      u: 0,
      v: 0,
    }));
    this.geometry = Array.from({ length: count - 2 }, (_, i) => ({
      vertices:
        i & 1
          ? [this.vertices[i + 1], this.vertices[i], this.vertices[i + 2]]
          : [this.vertices[i], this.vertices[i + 1], this.vertices[i + 2]],
    }));
  }
  vertex(index, x, y, color, u, v) {
    const at = index * 24,
      d = this.view;
    d.setFloat32(at, x, true);
    d.setFloat32(at + 4, y, true);
    d.setFloat32(at + 8, 0, true);
    d.setUint32(at + 12, color, true);
    d.setFloat32(at + 16, u, true);
    d.setFloat32(at + 20, v, true);
  }
  project(width, height, matrix, viewport) {
    const d = this.view,
      vx = viewport?.[0] ?? 0,
      vy = viewport?.[1] ?? 0,
      vw = viewport?.[2] ?? width,
      vh = viewport?.[3] ?? height;
    for (let i = 0; i < this.vertices.length; i++) {
      const at = i * 24,
        x = d.getFloat32(at, true),
        y = d.getFloat32(at + 4, true),
        z = d.getFloat32(at + 8, true),
        v = this.vertices[i];
      let cx = x,
        cy = y,
        cz = z,
        cw = 1;
      if (matrix) {
        cx = f(x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]);
        cy = f(x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]);
        cz = f(x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]);
        cw = f(x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]);
      }
      v.w = f(1 / cw);
      v.x = f(f(f(cx * v.w) + 1) * f(vw * 0.5) + vx);
      v.y = f(f(1 - f(cy * v.w)) * f(vh * 0.5) + vy);
      v.z = f(cz * v.w);
      v.color = d.getUint32(at + 12, true);
      v.u = d.getFloat32(at + 16, true);
      v.v = d.getFloat32(at + 20, true);
    }
  }
}

export class EmoteGeometry {
  constructor(document, animation, { object, motion, meshRatio = 1 } = {}) {
    this.document = document;
    this.animation = animation;
    this.meshRatio = meshRatio;
    this.nodes = [];
    this.commands = [];
    this.patch = new EmotePatch();
    const base = document.metadata.base ?? {};
    this.root = this.compile(object ?? base.chara, motion ?? base.motion, null, new Set());
    this.rootState = {
      x: 0,
      y: 0,
      z: 0,
      opacity: 255,
      flipX: false,
      flipY: false,
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      slantX: 0,
      slantY: 0,
    };
    this.rootMatrix = new Float64Array(4);
  }
  compile(object, name, owner, path) {
    const key = `${object}/${name}`;
    if (path.has(key) || path.size > 24) throw new Error(`Recursive E-mote motion ${key}`);
    path = new Set(path);
    path.add(key);
    const motion = this.document.motion(object, name),
      group = { motion, owner, nodes: [], flat: [], name: key };
    const visit = (layer, parent) => {
      if (this.nodes.length >= 16384) throw new Error('E-mote layer count exceeds limit');
      if (![0, 1, 2, 3, 12].includes(layer.type))
        throw new Error(`Unsupported E-mote layer type ${layer.type} (${layer.label})`);
      const node = nodeRecord(layer, group, parent);
      node.localIndex = group.flat.length;
      group.flat.push(node);
      node.order = this.nodes.length;
      this.nodes.push(node);
      (parent?.children ?? group.nodes).push(node);
      if (layer.type === 3)
        for (const frame of node.frames) {
          const c = frame.content;
          if (frame.type && c.src && c.icon && !node.motions.has(`${c.src}/${c.icon}`))
            node.motions.set(`${c.src}/${c.icon}`, this.compile(c.src, c.icon, node, path));
        }
      for (const child of layer.children ?? []) visit(child, node);
      return node;
    };
    for (const layer of motion.layer ?? []) visit(layer, null);
    return group;
  }
  evaluate(node, time) {
    const frames = node.frames;
    let lo = 0,
      hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    const a = frames[lo - 1],
      b = frames[lo];
    if (!a?.type) return false;
    if (a.type === 3 && b?.type && b.time > a.time)
      interpolateContent(
        node.state,
        a.content,
        b.content,
        f(f(time - a.time) / f(b.time - a.time)),
      );
    else copyContent(node.state, a.content);
    return true;
  }
  update() {
    this.commands.length = 0;
    for (const node of this.nodes) node.active = false;
    const a = this.animation,
      r = this.rootState,
      scale = a.root.scale.value[0];
    r.x = a.root.position.value[0];
    r.y = a.root.position.value[1];
    r.angle = a.angleDegrees();
    r.scaleX = scale * (a.mirrorChanged ? -1 : 1);
    r.scaleY = scale;
    localMatrix(this.rootMatrix, r);
    const rgba = a.root.color.value;
    this.color =
      ((Math.trunc(rgba[3]) << 24) |
        (Math.trunc(rgba[0]) << 16) |
        (Math.trunc(rgba[1]) << 8) |
        Math.trunc(rgba[2])) >>>
      0;
    // The DLL wrapper supplies the player weight as inherited weight too.
    this.color = colorProduct(this.color, this.color);
    this.updateGroup(this.root, 0, r, this.rootMatrix, null);
    this.rank = 0;
    this.rankGroup(this.root);
    this.commands.sort(
      (left, right) => left.z - right.z || left.order - right.order || left.row - right.row,
    );
    this.applyMasks();
    return this.commands;
  }
  updateGroup(group, time, root, rootMatrix, meshAncestor) {
    time = parameterTime(group.motion, group.motion.parameterize, this.animation.bound, time);
    group.time = time;
    const visit = (node, parent, parentMatrix, ancestor) => {
      let inheritedParent = node.parent;
      while (inheritedParent && inheritedParent.layer.inheritMask & skipParentTransform)
        inheritedParent = inheritedParent.parent;
      if (node.parent && inheritedParent !== node.parent) {
        parent = inheritedParent?.state ?? root;
        parentMatrix = inheritedParent?.matrix ?? rootMatrix;
      }
      const l = node.layer,
        s = node.state,
        ownTime = parameterTime(group.motion, l.parameterize, this.animation.bound, time);
      const active = this.evaluate(node, ownTime);
      node.selectedMotion = null;
      node.active = active;
      node.visible = active;
      node.hasMesh = false;
      node.separator = false;
      node.ancestor = ancestor;
      if (!active) {
        for (const name of [...fields, 'x', 'y', 'z', 'opacity']) s[name] = parent[name];
        node.matrix.set(parentMatrix);
      } else {
        const mask = l.inheritMask ?? 0;
        for (const name of fields) node.transformState[name] = s[name];
        localMatrix(node.scratch, s, l.transformOrder);
        for (let i = 0; i < fields.length; i++) {
          const name = fields[i],
            inherit = mask & flags[i],
            p = parent;
          if (!inherit) continue;
          if (name === 'flipX' || name === 'flipY') s[name] = s[name] !== Boolean(p[name]);
          else if (name === 'scaleX' || name === 'scaleY') s[name] *= p[name];
          else s[name] += p[name];
        }
        const x = s.x,
          y = s.y,
          z = s.z;
        s.x = f(f(f(parentMatrix[0] * x) + f(parentMatrix[2] * (l.coordinate ? z : y))) + parent.x);
        s.y = l.coordinate
          ? f(y + parent.y)
          : f(f(f(parentMatrix[1] * x) + f(parentMatrix[3] * y)) + parent.y);
        s.z = l.coordinate
          ? f(f(f(parentMatrix[1] * x) + f(parentMatrix[3] * z)) + parent.z)
          : f(z + parent.z);
        s.opacity = Math.trunc((s.opacity * (mask & 1024 ? parent.opacity : root.opacity)) / 255);
        // Position always follows the parent. Only selected transform channels
        // inherit from it; other channels inherit the motion's root.
        if ((mask & 508) === 508) {
          const q = node.scratch,
            p = parentMatrix;
          node.matrix[0] = f(f(p[0] * q[0]) + f(p[2] * q[1]));
          node.matrix[1] = f(f(p[1] * q[0]) + f(p[3] * q[1]));
          node.matrix[2] = f(f(p[0] * q[2]) + f(p[2] * q[3]));
          node.matrix[3] = f(f(p[1] * q[2]) + f(p[3] * q[3]));
        } else {
          const t = node.transformState;
          for (let i = 0; i < fields.length; i++)
            if (mask & flags[i]) {
              const name = fields[i];
              if (name === 'flipX' || name === 'flipY') t[name] = s[name] !== Boolean(root[name]);
              else if (name === 'scaleX' || name === 'scaleY') t[name] = s[name] / root[name];
              else t[name] = s[name] - root[name];
            }
          localMatrix(node.scratch, t, l.transformOrder);
          const q = node.scratch,
            p = rootMatrix;
          node.matrix[0] = f(f(p[0] * q[0]) + f(p[2] * q[1]));
          node.matrix[1] = f(f(p[1] * q[0]) + f(p[3] * q[1]));
          node.matrix[2] = f(f(p[0] * q[2]) + f(p[2] * q[3]));
          node.matrix[3] = f(f(p[1] * q[2]) + f(p[3] * q[3]));
        }
        node.ancestor = ancestor;
        node.separator = Boolean(ancestor && !(mask & 33554432));
        this.bindSource(node);
        if (node.icon) this.build(node, ancestor);
        if (l.type === 3) {
          const child = node.motions.get(`${s.src}/${s.icon}`);
          if (child) {
            node.selectedMotion = child;
            this.updateGroup(child, s.timeOffset, s, node.matrix, ancestor);
          }
        }
      }
      const next = node.hasMesh || node.separator ? node : node.ancestor;
      for (const child of node.children) visit(child, s, node.matrix, next);
    };
    for (const node of group.nodes) visit(node, root, rootMatrix, meshAncestor);
  }
  rankGroup(group) {
    let priority = null;
    for (const frame of group.motion.priority ?? []) {
      if (frame.time > group.time) break;
      if (frame.content) priority = frame.content;
    }
    const indices = priority ?? group.flat.map((_, index) => index);
    for (let at = indices.length - 1; at >= 0; at--) {
      const node = group.flat[indices[at]];
      if (!node) throw new Error(`E-mote priority references unknown layer ${indices[at]}`);
      if (!node.active) continue;
      if (node.selectedMotion) this.rankGroup(node.selectedMotion);
      else {
        const rank = this.rank++;
        for (const packet of node.packets) packet.order = rank;
      }
    }
  }
  bindSource(node) {
    const s = node.state,
      key = `${s.src}/${s.icon}`;
    if (node.bindings.has(key)) {
      node.icon = node.bindings.get(key);
      return;
    }
    let icon = null;
    if (s.src === 'blank' && s.icon) {
      const [width, height, originX, originY] = s.icon.split(':').map(Number);
      if ([width, height, originX, originY].every(Number.isFinite))
        icon = { width, height, originX, originY, blank: true };
    } else if (this.document.sources.has(s.src)) icon = this.document.icon(s.src, s.icon);
    node.bindings.set(key, icon);
    node.icon = icon;
  }
  build(node, ancestor) {
    const icon = node.icon,
      s = node.state,
      m = node.matrix,
      w = icon.width,
      h = icon.height,
      ox = (icon.originX ?? 0) + s.ox,
      oy = (icon.originY ?? 0) + s.oy,
      orgX = f(s.x - f(f(m[2] * oy) + f(ox * m[0]))),
      orgY = f(s.y - f(f(oy * m[3]) + f(ox * m[1]))),
      c = node.corners;
    c[0] = orgX;
    c[1] = orgY;
    c[2] = orgX + m[0] * w;
    c[3] = orgY + m[1] * w;
    c[4] = orgX + f(f(m[0] * w) + f(m[2] * h));
    c[5] = orgY + f(f(m[1] * w) + f(m[3] * h));
    c[6] = orgX + m[2] * h;
    c[7] = orgY + m[3] * h;
    node.rawPatch = node.layer.meshTransform === 1 && s.hasPatch ? s.patch : null;
    node.patch = node.rawPatch;
    node.hasMesh = Boolean(
      node.patch && node.layer.meshTransform && node.layer.meshSyncChildMask & 8,
    );
    if (node.layer.meshCombine && node.hasMesh) {
      node.combined.set(node.rawPatch);
      let parent = node.parent ?? node.group.owner;
      while (parent) {
        if (parent.hasMesh) {
          if (parent === ancestor) ancestor = parent.ancestor;
          for (let i = 0; i < 32; i++)
            node.combined[i] = f(node.combined[i] + f(parent.rawPatch[i] - identityPatch[i]));
        }
        if (!parent.layer.meshCombine) break;
        parent = parent.parent ?? parent.group.owner;
      }
      node.patch = node.combined;
    }
    node.ancestor = ancestor;
    node.separator = Boolean(ancestor && !((node.layer.inheritMask ?? 0) & 33554432));
    if (node.patch) {
      const p = node.patch,
        t = node.transformed;
      for (let i = 0; i < 16; i++) {
        t[i * 2] = f(orgX + f(f(f(m[0] * w) * p[i * 2]) + f(f(m[2] * h) * p[i * 2 + 1])));
        t[i * 2 + 1] = f(orgY + f(f(f(m[1] * w) * p[i * 2]) + f(f(m[3] * h) * p[i * 2 + 1])));
      }
      const determinant = m[0] * w * m[3] * h - m[2] * h * m[1] * w,
        inv = node.inverse;
      inv[0] = (m[3] * h) / determinant;
      inv[2] = (-m[2] * h) / determinant;
      inv[1] = (-m[1] * w) / determinant;
      inv[3] = (m[0] * w) / determinant;
      inv[4] = -f(orgX);
      inv[5] = -f(orgY);
    }
    if (icon.blank || ![0, 12].includes(node.layer.type) || s.opacity <= 0) return;
    let division = 0;
    if (node.patch) division = node.layer.meshDivision ?? 16;
    else if (ancestor) {
      let source = ancestor;
      while (source && !source.hasMesh) source = source.ancestor;
      if (source)
        division = Math.min(
          50,
          Math.trunc(
            ((source.layer.meshDivision ?? 16) * (w + h)) /
              (source.icon.width + source.icon.height),
          ),
        );
    }
    const [nx, ny] = division ? patchDivisions(division, w, h, this.meshRatio) : [1, 1],
      key = `${nx}/${ny}`;
    if (!node.packetSets.has(key))
      node.packetSets.set(
        key,
        Array.from({ length: ny }, () => new EmotePacket((nx + 1) * 2)),
      );
    node.packets = node.packetSets.get(key);
    const uv = icon.texture,
      u0 = icon.left ?? 0,
      v0 = icon.top ?? 0,
      du = f(w / nx),
      dv = f(h / ny),
      inverseWidth = f(1 / uv.width),
      inverseHeight = f(1 / uv.height);
    for (let i = 0; i < 4; i++) {
      let color = colorProduct(s.colors[i], this.color);
      if (!(s.blend & 16) && (s.blend & 15) !== 6)
        color =
          (color & 0xff000000) |
          ((color >>> 1) & 0x7f7f7f) /* exe-address-check: non-address - RGB byte-halving mask */;
      node.colors[i] =
        ((Math.trunc(((color >>> 24) * s.opacity) / 255) << 24) | (color & 0xffffff)) >>> 0;
    }
    const point = (u, v, out) => {
      let x, y;
      if (node.patch) [x, y] = this.patch.evaluate(node.transformed, u, v);
      else {
        const fu = f(u),
          fv = f(v),
          iu = f(1 - fu),
          iv = f(1 - fv),
          leftX = f(f(fv * c[6]) + f(iv * c[0])),
          leftY = f(f(fv * c[7]) + f(iv * c[1])),
          rightX = f(f(fv * c[4]) + f(iv * c[2])),
          rightY = f(f(fv * c[5]) + f(iv * c[3]));
        x = f(f(rightX * fu) + f(leftX * iu));
        y = f(f(rightY * fu) + f(leftY * iu));
      }
      let walk = ancestor,
        px = s.x,
        py = s.y;
      if (!node.separator)
        while (walk && !walk.separator) {
          if (walk.hasMesh) {
            [x, y] = this.patch.map(walk.transformed, walk.inverse, x, y);
            [px, py] = this.patch.mapPosition(walk.transformed, walk.inverse, px, py);
          }
          walk = walk.ancestor;
        }
      const startX = px,
        startY = py;
      while (walk) {
        if (walk.hasMesh) [px, py] = this.patch.mapPosition(walk.transformed, walk.inverse, px, py);
        walk = walk.ancestor;
      }
      if (startX !== px || startY !== py) {
        x = f(x + f(px - startX));
        y = f(y + f(py - startY));
      }
      out[0] = x;
      out[1] = y;
    };
    for (let row = 0; row < ny; row++) {
      const packet = node.packets[row];
      packet.texture = uv;
      packet.z = s.z;
      packet.order = node.order;
      packet.row = row;
      packet.blend = s.blend;
      packet.stencil = 0;
      packet.maskWrite = false;
      packet.node = node;
      for (let col = 0; col <= nx; col++)
        for (let side = 0; side < 2; side++) {
          const u = node.patch ? f(col / nx) : f(col * f(1 / nx)),
            v = node.patch ? f((row + side) / ny) : f((row + side) * f(1 / ny)),
            index = col * 2 + side;
          point(u, v, this.patch.result);
          const color = colorBilinear(node.colors, u, v);
          packet.vertex(
            index,
            this.patch.result[0],
            this.patch.result[1],
            color,
            f(f(f(col * du) + u0) * inverseWidth),
            f(f(f((row + side) * dv) + v0) * inverseHeight),
          );
        }
      this.commands.push(packet);
    }
  }
  applyMasks() {
    const plain = this.commands.slice();
    this.commands.length = 0;
    for (const node of this.nodes) node.maskReference = 0;
    let reference = 0;
    for (const composite of this.nodes) {
      if (
        !composite.active ||
        !composite.layer.stencilType ||
        !composite.layer.stencilCompositeMaskLayerList?.length
      )
        continue;
      if (reference >= 255) throw new Error('E-mote stencil reference count exceeds 255');
      composite.maskReference = ++reference;
    }
    const contains = (node, parent) => {
      while (node) {
        if (node === parent) return true;
        node = node.parent ?? node.group.owner;
      }
      return false;
    };
    const emitted = new Set();
    for (const command of plain) {
      let node = command.node,
        composite = null;
      while (node) {
        if (node.maskReference) {
          composite = node;
          break;
        }
        node = node.parent ?? node.group.owner;
      }
      if (composite) {
        command.stencil = composite.maskReference;
        if (!emitted.has(command.node)) {
          emitted.add(command.node);
          for (const label of composite.layer.stencilCompositeMaskLayerList) {
            const roots = this.nodes.filter(
              (node) => node.group === composite.group && node.layer.label === label,
            );
            for (const mask of plain)
              if (roots.some((root) => contains(mask.node, root))) {
                const copy = (mask.maskPacket ??= new EmotePacket(mask.vertices.length));
                copy.bytes.set(mask.bytes);
                for (let at = 12; at < copy.bytes.length; at += 24)
                  copy.view.setUint32(at, 0xffffffff, true);
                copy.texture = mask.texture;
                copy.blend = 6;
                copy.stencil = composite.maskReference;
                copy.maskWrite = true;
                copy.node = mask.node;
                this.commands.push(copy);
              }
          }
        }
      }
      this.commands.push(command);
    }
  }
  project(width, height, matrix, viewport) {
    for (const command of this.commands) command.project(width, height, matrix, viewport);
    return this.commands;
  }
  anchor(label) {
    const node = this.nodes.find((node) => node.layer.label === label && node.active);
    return node ? [node.state.x, node.state.y] : null;
  }
}
