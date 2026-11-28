// SPDX-License-Identifier: MPL-2.0
// Combines prepared public-source CPU algorithms; no World, EXE or GPU owner.
import {
  createInstanceTransformScratch,
  initializeInstanceTransform,
  calculateInstanceTransform,
} from './instance-transform.mjs';
import {
  initializeGroup,
  initializeInstance,
  updateCachedState,
  beginRenderingGroup,
  renderColorEvaluation,
  advanceRenderingGroup,
  createRenderOutput,
} from './render-state.mjs';

const renderable = (node) => node.type !== 'root' && node.type !== 'none';
const context = (instance) => ({
  livingTime: instance.age,
  livedTime: instance.life,
  sequence: instance.sequence,
});

export function createEffekseerInstanceOperations() {
  const scratch = createInstanceTransformScratch();
  return {
    initializeGroup({ node, random }) {
      return renderable(node) ? initializeGroup(node, random) : null;
    },
    initializeInstance(input) {
      return initializeInstanceTransform({
        ...input,
        scratch,
        initializeRendered: ({ node, instance, random }) =>
          renderable(node) ? initializeInstance(node, random, context(instance)) : null,
      });
    },
    calculateInstance(input) {
      return calculateInstanceTransform({
        ...input,
        scratch,
        updateRendered: ({ node, instance, state }) => {
          if (renderable(node)) updateCachedState(node, state, context(instance));
        },
      });
    },
  };
}

// CPU packet seam for a later shared StageRenderer mesh implementation. Outputs
// are reused and must be consumed immediately, or copied by an offline observer.
// No packet here is a claim that pixels were rendered.
export function createEffekseerColorVisitor({ manager, onInstance, beginNode, endNode } = {}) {
  if (!manager || typeof onInstance !== 'function')
    throw new TypeError('Effekseer CPU packet consumer is required');
  const outputs = new Map();
  return {
    beginNode,
    beginGroup({ node, group }) {
      if (node.type === 'ribbon' || node.type === 'track') {
        const first = group.active.length ? manager.instances.get(group.active[0]) : null;
        beginRenderingGroup(node, group.values, {
          instanceCount: group.active.length,
          firstContext: first ? context(first) : null,
        });
      }
    },
    instance({ set, node, group, instance }) {
      let out = outputs.get(node.type);
      if (!out) {
        out = createRenderOutput(node.type);
        outputs.set(node.type, out);
      }
      renderColorEvaluation(node, instance.values.rendered, context(instance), {
        group: group.values,
        out,
      });
      // These are the observed 76 wrapper's unavailable services. Simulation,
      // cache evaluation and packet creation still happen for those nodes.
      const unavailable =
        node.type === 'model'
          ? 'verified-null-model-loader'
          : node.texture.distortion
            ? 'verified-null-distortion-background'
            : null;
      onInstance({ set, node, group, instance, output: out, unavailable });
      if (node.type === 'ribbon' || node.type === 'track') advanceRenderingGroup(group.values);
    },
    endNode,
  };
}
