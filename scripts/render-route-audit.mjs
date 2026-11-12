// SPDX-License-Identifier: MPL-2.0
// Offline review evidence, not ABI data or a runtime dispatch table.
// The three lists cover the actual installed graphics/draw/mesh wrappers.
const routes = {
  graphics: [
    [0x4e, 'plane.texturedRectangle', [41]],
    [0x4f, 'plane.coloredRectangle', [42]],
    [0x50, 'plane.emptyCustomModel', [45]],
    [0x53, 'plane.unload', [68]],
    [0x54, 'plane.setPosition', [51]],
    [0x55, 'plane.setBaseXY', [61, 49]],
    [0x56, 'plane.getBaseXY', [61]],
    [0x57, 'plane.getPosition', [62]],
    [0x58, 'plane.setPriority', [61, 49]],
    [0x59, 'plane.getPriority', [61]],
    [0x5a, 'plane.inheritPosition', [53]],
    [0x5b, 'plane.stopInheritingPosition', [54]],
    [0x5c, 'plane.setShown', [47]],
    [0x5d, 'plane.setRotation', [55]],
    [0x5e, 'plane.setAlpha', [63]],
    [0x62, 'plane.buttonState', [74]],
    [0x63, 'plane.unregisterInput', [90]],
    [0x64, 'plane.setColor', [59]],
    [0x65, 'plane.setScale', [66]],
    [0x66, 'plane.setImageIndex', [77]],
    [0x67, 'plane.setButtonDelay', [78]],
    [0x68, 'plane.registerInputRectangle', [89]],
    [0x69, 'plane.setInputEnabled', [92]],
    [0x6a, 'plane.setInputActive', [93]],
    [0x6c, 'plane.setInputReturn', [94]],
    [0x6d, 'plane.inputSource', [95]],
    [0x6e, 'plane.setInputReceiver', [96]],
    [0x350, 'plane.setHoverEnabled', [98]],
    [0x351, 'plane.setDragEnabled', [99]],
    [0x157, 'plane.size', [75]],
    [0x158, 'plane.setMatrix', [57]],
    [0x159, 'plane.bounds', [76]],
    [0x192, 'plane.setBlend', [81]],
    [0x21d, 'texture.releaseRectangle', []],
    [0x21e, 'texture.allocateMissingPages', []],
  ],
  'draw-task': [
    [0x100, 'draw.initialize', [279]],
    [0x101, 'draw.addBitmap', [280]],
    [0x102, 'draw.remove', [281]],
    [0x103, 'draw.updateBitmap', [282]],
    [0x104, 'draw.setOutputOffset', [283]],
    [0x105, 'draw.bitmap', [285]],
    [0x106, 'draw.setRasterEnabled', [286]],
    [0x107, 'draw.setEntryShown', [287]],
    [0x108, 'draw.queryCountDiscarded', [288]],
    [0x153, 'draw.clip', [289]],
    [0x154, 'draw.render', [290]],
    [0x155, 'draw.clear', [291]],
    [0x156, 'draw.forceOutput', [292]],
    [0x1c7, 'draw.copyBase', [296]],
    [0x1ce, 'draw.getLayer', [298]],
    [0x1cf, 'draw.setLayer', [299]],
    [0x1d0, 'draw.refreshEntry', [300]],
    [0x216, 'draw.setDirty', [304]],
    [0x291, 'draw.entryBitmap', [307]],
    [0x35e, 'draw.renderRectangle', [310]],
  ],
  mesh: [
    [0x1d2, 'plane.setCoordinateMode', [82]],
    [0x1d3, 'plane.loadDividedMesh', [83]],
  ],
};

export const RENDER_ROUTE_AUDIT = Object.freeze(
  Object.entries(routes).flatMap(([module, rows]) =>
    rows.map(([id, semanticName, messages]) => ({
      id,
      semanticName,
      module: `src/native/${module}.mjs`,
      messages,
      receiver:
        module === 'draw-task'
          ? 'kind 15 → NativeDrawTask.message → NativeRetainedDraw/JS bitmap pixels'
          : !messages.length
            ? 'NativeTexturePages (JS owned pages and StageRenderer surfaces)'
            : 'kind 2 → NativeGraphicTask.message; kind 6 → JS BasePlane subset',
      evidence: [
        'src/native/graphics.mjs:installNativeGraphics',
        `src/native/${module}.mjs:native${module === 'draw-task' ? 'Draw' : module === 'mesh' ? 'Mesh' : 'Graphics'}`,
        'src/native/engine-message.mjs:dispatchNative/route',
        ...(module === 'draw-task'
          ? ['tests/differential/draw-raster.test.mjs']
          : ['tests/differential/plane-state.test.mjs']),
      ],
      consumerRoutes: messages.length
        ? [
            {
              domain: 8,
              condition:
                'ABI capabilities.embeddedJavaScript is true and target is native SDK JavaScript task kind 55',
              module: 'src/native/sdk-javascript-task.mjs',
              method: 'NativeSDKJavaScriptTask.message',
              implementation: 'original-handler',
              removePhase: 8,
            },
          ]
        : [],
    })),
  ),
);

export function reviewedRenderRoute(file, id) {
  return RENDER_ROUTE_AUDIT.find((row) => row.module === file && row.id === id);
}

// Only these already traced sites are resolved. A new factory name/method stays
// needs-review; no blanket suppression of indirect calls in a render module.
const indirect = {
  'emote-commands': ['sendNativeEngine'],
  'emote-task': ['sendNativeEngine'],
  'area-effect-commands': ['sendNativeEngine'],
  'area-effect': ['getNativeFeature:graphics-platform'],
  'draw-commands': ['sendNativeEngine'],
  'draw-task': [
    'sendNativeEngine',
    'getNativeFeature:graphics-platform',
    'getNativeFeature:bitmap-memory',
  ],
  'effect-commands': ['sendNativeEngine'],
  graphics: [
    'sendNativeEngine',
    'sendEngine',
    'getNativeFeature:plane-movie-projection',
    'getNativeFeature:graphics-platform',
    'getNativeFeature:directshow',
    'getNativeFeature:texture-movie-renderer',
    'getNativeFeature:engine-workers',
    'getNativeFeature:vmr9',
    'getNativeFeature:bitmap-memory',
  ],
  mesh: ['sendNativeEngine'],
  'particle-commands': ['sendNativeEngine'],
  'plane-model-command': ['sendNativeEngine'],
};
export function reviewRenderIndirect(file, site) {
  const name = file.match(/^src\/native\/([^/]+)\.mjs$/)?.[1];
  const key = site.method + (site.feature ? ':' + site.feature : '');
  if (!indirect[name]?.includes(key)) return null;
  if (name === 'emote-commands')
    return '37 registered M2 wrappers send the reviewed 524..554 family to task54; M2Task, its owner, model and controller state are JS. No model/task pointer projection is made.';
  if (name === 'emote-task')
    return 'Explicit public sound-task queries for media clock, envelope levels and JS sidecar handles; NativeSoundTask owns these messages and invokes no model/DLL code.';
  if (name === 'area-effect' && site.feature === 'graphics-platform')
    return 'Explicit context.nativePointer bitmap wrappers from D8 task transport borrow the existing bitmap view. Default FES sends semantic JS handles and never enters this branch.';
  if (site.method === 'getNativeFeature')
    return 'Explicit remaining consumer factory: SDK bitmap/view records and media decoder (8). Registration/construction does not run the original graphics worker. See the named non-native projections.';
  return 'Traced JS task routing and factories: ordinary render receivers are JS. Controls 40/41/42 are JS; SDK kind55 (8) retains its explicit message/lifecycle boundary.';
}
