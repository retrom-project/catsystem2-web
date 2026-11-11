// SPDX-License-Identifier: MPL-2.0
// These legacy modules are served only to explicit browser oracle fixtures.
import { readFile, readdir } from 'node:fs/promises';
export async function routeGraphicsOracle(page) {
  for (const file of [
    'tests/fixtures/graphics-oracle-world.mjs',
    ...(await readdir(new URL('../../oracle/', import.meta.url)))
      .filter((file) => /^m2-.*\.mjs$/.test(file))
      .map((file) => 'oracle/' + file),
    'oracle/area-geometry-projection.mjs',
    ...[
      'graphics',
      'graphics-process',
      'graphics-render',
      'graphics-task',
      'renderer',
      'texture-memory',
      'screen-graph',
    ].map((name) => `oracle/${name}-original.mjs`),
  ]) {
    const body = await readFile(new URL('../../' + file, import.meta.url));
    await page.route('**/' + file, (route) =>
      route.fulfill({ body, contentType: 'text/javascript' }),
    );
  }
}
