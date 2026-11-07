// SPDX-License-Identifier: MPL-2.0
import { open, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { GameFiles } from '../src/files.mjs';
export class NodeFile {
  constructor(path, size) {
    this.path = path;
    this.size = size;
  }
  async read(at, count) {
    if (at < 0 || count < 0 || at + count > this.size) throw new Error('File read out of bounds');
    const handle = await open(this.path, 'r');
    try {
      const bytes = new Uint8Array(count);
      let done = 0;
      while (done < count) {
        const { bytesRead } = await handle.read(bytes, done, count - done, at + done);
        if (!bytesRead) throw new Error('Truncated file');
        done += bytesRead;
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }
}
export async function walk(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(root, path)));
    else if (entry.isFile())
      result.push({
        path: relative(root, path).split('\\').join('/'),
        size: (await stat(path)).size,
      });
  }
  return result;
}
export async function nodeGame(root) {
  const files = await walk(root),
    game = new GameFiles(
      new Map(files.map((f) => [f.path, new NodeFile(join(root, f.path), f.size)])),
    );
  await game.open();
  return game;
}
