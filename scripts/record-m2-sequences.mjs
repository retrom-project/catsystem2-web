// SPDX-License-Identifier: MPL-2.0
// Uses the existing oracle task/native boundary with independently authored data.
import { deflateSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { emoteM2Cases } from '../tests/fixtures/emote-m2-sequences.mjs';
import { kcsProgram } from '../tests/helpers.mjs';

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    driver: { type: 'string' },
    output: { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:4119' },
    case: { type: 'string' },
  },
});
if (!values.engine || !values.driver || !values.output)
  throw new Error(
    'Usage: --engine /private/engine.exe --driver /private/emotedriver.dll --output golden.json [--url URL]',
  );
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'),
  engine = await readFile(values.engine),
  driver = await readFile(values.driver),
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
try {
  const cases = [];
  for (const { files, ...definition } of emoteM2Cases()) {
    if (values.case && definition.name !== values.case) continue;
    const page = await browser.newPage();
    try {
      for (const name of (await readdir('oracle')).filter((name) => /^m2-.*\.mjs$/.test(name))) {
        const source = await readFile('oracle/' + name);
        await page.route('**/oracle/' + name, (route) =>
          route.fulfill({ body: source, contentType: 'text/javascript' }),
        );
      }
      for (const [name, bytes] of [
        ['engine.exe', engine],
        ['emotedriver.dll', driver],
      ])
        await page.route('**/m2-oracle/' + name, (route) => route.fulfill({ body: bytes }));
      await page.goto(values.url);
      const rows = await page.evaluate(
        async (input) => {
          const { recordM2Sequence } = await import('/oracle/m2-sequences-browser.mjs');
          for (const name of ['engine.exe', 'emotedriver.dll'])
            input.entries.push([
              name,
              new Uint8Array(await (await fetch('/m2-oracle/' + name)).arrayBuffer()),
            ]);
          return recordM2Sequence(input);
        },
        {
          ...definition,
          capturePixels: true,
          entries: Object.entries({ ...files, 'main.kcs': kcsProgram([[59]]) }).map(
            ([name, bytes]) => [name, [...bytes]],
          ),
        },
      );
      for (const row of rows) {
        row.rgbaDeflate = deflateSync(Uint8Array.from(row.pixels)).toString('base64');
        delete row.pixels;
      }
      cases.push({
        ...definition,
        inputs: Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
        rows,
      });
      console.log(`${definition.name}: ${rows.length} frames`);
    } finally {
      await page.close();
    }
  }
  await writeFile(
    values.output,
    JSON.stringify(
      {
        source:
          'Existing M2 task/native oracle; EXE and DLL supplied privately; authored model/configuration only',
        generator: await Promise.all(
          [
            'scripts/record-m2-sequences.mjs',
            'oracle/m2-sequences-browser.mjs',
            'tests/fixtures/emote-m2-sequences.mjs',
          ].map(async (file) => ({ file, sha256: hash(await readFile(file)) })),
        ),
        engine: hash(engine),
        driver: hash(driver),
        tolerance: { vertexWords: 0, integerOutputs: 0, pixels: 0 },
        cases,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
