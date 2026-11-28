// SPDX-License-Identifier: MPL-2.0
import { PSB } from '../../src/formats/psb.mjs';
import { emotePSBFixture, encodeAuthoredPSB } from './emote-psb-fixture.mjs';
export function emoteGeometryCases() {
  const cases = [];
  const add = (name, edit, steps = [{ elapsed: 0 }]) => cases.push({ name, edit, steps });
  add('quad', () => {}, [{ elapsed: 0 }, { elapsed: 120 }]);
  add('origin', (_r, l) => Object.assign(l.frameList[0].content, { mask: 3, ox: 0.25, oy: 0.75 }));
  add('angle', (_r, l) => Object.assign(l.frameList[0].content, { mask: 18, angle: 30 }));
  add('slant', (_r, l) => Object.assign(l.frameList[0].content, { mask: 386, sx: 0.25, sy: -0.5 }));
  for (const blend of [0, 1, 2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 21, 22])
    add(`blend-${blend}`, (_r, l) =>
      Object.assign(l.frameList[0].content, { mask: 131074, bm: blend }),
    );
  add('color', (_r, l) =>
    Object.assign(l.frameList[0].content, { mask: 1538, color: 0xff806040, opa: 120 }),
  );
  for (const deformed of [false, true])
    add(deformed ? 'patch-bent' : 'patch-identity', (_r, l) => {
      Object.assign(l, { meshDivision: 4, meshTransform: 1, meshSyncChildMask: 8 });
      l.frameList[0].content.mask |= 33554432;
      l.frameList[0].content.mesh = {
        cc: null,
        bp: Array.from({ length: 32 }, (_, i) => {
          const x = ((i >> 1) & 3) / 3,
            y = (i >> 3) / 3;
          return Math.fround(
            (i & 1 ? y : x) + (deformed ? (i & 1 ? x * (1 - y) * 0.25 : y * (1 - x) * 0.125) : 0),
          );
        }),
      };
    });
  add('parent-transform', (r, l) => {
    const child = structuredClone(l);
    child.label = 'child';
    child.inheritMask = 2044;
    child.frameList[0].content = { mask: 18, src: 'tex', icon: 'dot', coord: [2, 1, 0], angle: 30 };
    Object.assign(l, { type: 2, children: [child] });
    l.frameList[0].content = { mask: 114, coord: [1, -2, 0], angle: 30, zx: 0.75, zy: 1.25 };
    r.object.body.motion.base.priority[0].content = [0, 1];
    r.object.body.motion.base.layerIndexMap = { image: 0, child: 1 };
  });
  add('child-motion', (r, l) => {
    const sub = structuredClone(r.object.body.motion.base);
    sub.layer[0].frameList[0].content.coord = [2, 3, 0];
    r.object.body.motion.sub = sub;
    l.type = 3;
    l.frameList[0].content = {
      mask: 524290,
      coord: [1, -2, 0],
      src: 'body',
      icon: 'sub',
      motion: { mask: 0, timeOffset: 0 },
    };
  });
  for (const z of [false, true])
    add(z ? 'z-order' : 'priority-order', (r, l) => {
      const other = structuredClone(l);
      other.label = 'second';
      l.frameList[0].content.coord = [-0.5, 0, z ? 1 : 0];
      other.frameList[0].content.coord = [0.5, 0, z ? -1 : 0];
      Object.assign(r.object.body.motion.base, {
        layer: [l, other],
        layerIndexMap: { image: 0, second: 1 },
      });
      r.object.body.motion.base.priority[0].content = [0, 1];
    });
  add('parent-patch', (r, l) => {
    const child = structuredClone(l);
    child.label = 'child';
    child.inheritMask = 33556476;
    Object.assign(l, {
      meshDivision: 4,
      meshTransform: 1,
      meshSyncChildMask: 8,
      children: [child],
    });
    l.frameList[0].content = {
      mask: 33554432,
      src: 'blank',
      icon: '2:2:1:1',
      mesh: {
        cc: null,
        bp: Array.from({ length: 32 }, (_, i) => {
          const x = ((i >> 1) & 3) / 3,
            y = (i >> 3) / 3;
          return Math.fround((i & 1 ? y : x) + (i & 1 ? x * (1 - y) * 0.25 : y * (1 - x) * 0.125));
        }),
      },
    };
    r.object.body.motion.base.priority[0].content = [0, 1];
    r.object.body.motion.base.layerIndexMap = { image: 0, child: 1 };
  });
  const parentPatch = cases.find((c) => c.name === 'parent-patch');
  add('mesh-combine', (r, l) => {
    parentPatch.edit(r, l);
    const leaf = structuredClone(l.children[0]),
      middle = structuredClone(l);
    leaf.label = 'leaf';
    Object.assign(middle, {
      label: 'middle',
      inheritMask: 33556476,
      meshCombine: 1,
      children: [leaf],
    });
    l.meshCombine = 1;
    l.children = [middle];
    r.object.body.motion.base.priority[0].content = [0, 1, 2];
    r.object.body.motion.base.layerIndexMap = { image: 0, middle: 1, leaf: 2 };
  });
  add('mesh-separator', (r, l) => {
    parentPatch.edit(r, l);
    const leaf = structuredClone(l.children[0]),
      middle = structuredClone(leaf);
    leaf.label = 'leaf';
    Object.assign(middle, { label: 'separator', type: 2, inheritMask: 2044, children: [leaf] });
    middle.frameList[0].content = { mask: 0 };
    l.children = [middle];
    r.object.body.motion.base.priority[0].content = [0, 1, 2];
    r.object.body.motion.base.layerIndexMap = { image: 0, separator: 1, leaf: 2 };
  });
  add('mesh-relative-resolution', (r, l) => {
    parentPatch.edit(r, l);
    l.meshDivision = 8;
    l.frameList[0].content.icon = '4:4:2:2';
  });
  const parentTransform = cases.find((c) => c.name === 'parent-transform');
  add(
    'partial-inheritance',
    (r, l) => {
      parentTransform.edit(r, l);
      l.children[0].inheritMask = 12;
    },
    [{ elapsed: 0 }, { elapsed: 0, root: { position: [0.25, 0.75], scale: 1.5, angle: 0.5 } }],
  );
  add('stencil', (r, l) => {
    const mask = structuredClone(l);
    mask.label = 'mask';
    mask.frameList[0].content = {
      mask: 98,
      src: 'tex',
      icon: 'dot',
      coord: [-0.5, 0, 0],
      zx: 0.5,
      zy: 1,
    };
    const child = structuredClone(l);
    child.label = 'child';
    child.inheritMask = 33556476;
    const group = structuredClone(l);
    Object.assign(group, {
      label: 'composite',
      type: 12,
      stencilType: 5,
      stencilCompositeMaskLayerList: ['mask'],
      children: [child],
    });
    group.frameList[0].content = { mask: 0, src: 'blank', icon: '2:2:1:1' };
    Object.assign(r.object.body.motion.base, {
      layer: [mask, group],
      layerIndexMap: { mask: 0, composite: 1, child: 2 },
    });
    r.object.body.motion.base.priority[0].content = [0, 1, 2];
  });
  add('trimmed-atlas', (r) => {
    Object.assign(r.source.tex.texture, {
      width: 4,
      height: 4,
      truncated_width: 3,
      truncated_height: 3,
    });
    Object.assign(r.source.tex.icon.dot, { left: 1, top: 1 });
    return Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 17) & 255);
  });
  for (const inherited of [false, true])
    add(inherited ? 'inherited-eleven-cells' : 'own-eleven-cells', (r, l) => {
      const base = cases.find((c) => c.name === (inherited ? 'parent-patch' : 'patch-bent'));
      base.edit(r, l);
      l.meshDivision = 20;
    });
  add(
    'inactive-patch',
    (r, l) => {
      cases.find((c) => c.name === 'patch-bent').edit(r, l);
      const content = structuredClone(l.frameList[0].content),
        motion = r.object.body.motion.base;
      motion.parameterize = 0;
      motion.parameter = [
        { id: 'pose', enabled: 1, rangeBegin: -1, rangeEnd: 1, division: 2, discretization: 0 },
      ];
      l.parameterize = 0;
      l.frameList = [
        { time: 0, type: 3, content },
        { time: 1, type: 3, content: { ...content, mesh: { bp: null, cc: null } } },
        { time: 2, type: 2, content },
        { time: 3, type: 0 },
      ];
    },
    [
      { elapsed: 0 },
      { elapsed: 0, variables: [{ name: 'pose', value: 0.5 }] },
      { elapsed: 0, variables: [{ name: 'pose', value: 0 }] },
    ],
  );
  for (const mesh of [false, true])
    add(mesh ? 'gradient-mesh' : 'gradient-quad', (r, l) => {
      if (mesh) cases.find((c) => c.name === 'patch-bent').edit(r, l);
      l.frameList[0].content.mask |= 512;
      l.frameList[0].content.color = [0xff4080ff, 0x4080c0b0, 0x20406090, 0x90b0d070];
    });
  add(
    'parameterized-priority',
    (r, l) => {
      cases.find((c) => c.name === 'priority-order').edit(r, l);
      const motion = r.object.body.motion.base;
      motion.parameterize = 0;
      motion.parameter = [
        { id: 'pose', enabled: 1, rangeBegin: -1, rangeEnd: 1, division: 2, discretization: 0 },
      ];
      motion.priority = [
        { time: 0, type: 1, content: [0, 1] },
        { time: 1, type: 1, content: [1, 0] },
        { time: 3, type: 1, content: null },
      ];
    },
    [{ elapsed: 0 }, { elapsed: 0, variables: [{ name: 'pose', value: -1 }] }],
  );
  for (const name of ['gradient-quad', 'gradient-mesh'])
    cases.find((c) => c.name === name).steps.push({ elapsed: 0, root: { color: 0x90a0b0c0 } });
  add('parent-transform-bypass', (r, l) => {
    cases.find((c) => c.name === 'parent-transform').edit(r, l);
    l.inheritMask |= 4194304;
  });
  return cases;
}
export function emoteGeometryModel(input) {
  const psb = new PSB(emotePSBFixture()),
    r = psb.root;
  const pixels = input.edit(r, r.object.body.motion.base.layer[0]);
  return encodeAuthoredPSB(r, [pixels instanceof Uint8Array ? pixels : psb.resource(0)]);
}
