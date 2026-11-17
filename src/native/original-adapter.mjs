// SPDX-License-Identifier: MPL-2.0
export function originalOwner(world) {
  return Boolean(world.transitionalExe?.ownsWorld?.(world));
}
export function originalOperation(world, operation, ...args) {
  const invoke = world.transitionalExe?.worldOperation;
  if (typeof invoke !== 'function')
    throw new Error(`${operation} requires an explicitly selected original oracle adapter`);
  return invoke(world, operation, args);
}
export function originalFeature(world, name, method, ...args) {
  return originalOperation(world, 'feature', name, method, args);
}

// Optional lifecycle observations exist only in explicit composition. They do
// not supply a replacement ordinary owner, heap or success result.
export function originalView(world, name, ...args) {
  return world?.transitionalExe?.worldState?.(world, name, args);
}

// Inspect only the current serialized checkpoint composition tag. The opaque
// physical payload is never consumed or discarded by the ordinary restore path.
export function requireCheckpointRestoreOwner(state, adapter) {
  const physical = state?.nativeEngine;
  if (physical === null || physical === undefined) return false;
  if (
    typeof adapter?.hasWorldCheckpoint !== 'function' ||
    typeof adapter?.restoreWorld !== 'function' ||
    adapter.hasWorldCheckpoint(state) !== true
  )
    throw new Error('Physical checkpoint data requires an explicitly selected restore owner');
  return true;
}
