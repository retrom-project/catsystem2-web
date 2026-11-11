// SPDX-License-Identifier: MPL-2.0
// The JS compositor orders graph and DLL submissions using one insertion clock.
export function compareNativeDrawItems(a, b) {
  return (
    a.priority - b.priority ||
    (a.order ?? a.nativeRenderOrder ?? 0) - (b.order ?? b.nativeRenderOrder ?? 0) ||
    Number(a.n) - Number(b.n)
  );
}
