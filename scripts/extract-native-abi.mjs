// SPDX-License-Identifier: MPL-2.0
// Offline observations only. No image is loaded into an execution backend.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPE, readPointerTable } from './native-audit.mjs';
import { readEngineVersion } from '../src/native/profile.mjs';

const run = promisify(execFile);
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function inspectNativeTables(bytes) {
  const pe = readPE(bytes);
  for (const section of pe.sections)
    if (section.rawOffset + section.rawSize > bytes.length)
      throw new Error('PE section exceeds the source file');
  const result = {
    sha256: digest(bytes),
    engineVersion: readEngineVersion(bytes),
    sections: pe.sections,
    status: 'needs-review',
    tables: [],
    candidates: [],
  };
  const wrappers = pe.sections.filter((s) =>
    /^(\.bind|\.enigma\d*|\.vmp\d*|upx\d*|\.adata)$/i.test(s.name),
  );
  if (wrappers.length) {
    result.status = 'needs-unwrapped-sample';
    result.reason = `Wrapper section marker ${wrappers.map((s) => s.name).join(', ')}`;
    return result;
  }
  const nt = bytes.readUInt32LE(60),
    headers = nt + 24 + bytes.readUInt16LE(nt + 20);
  for (const [index, section] of pe.sections.entries()) {
    const flags = bytes.readUInt32LE(headers + index * 40 + 36);
    if (section.executable || !(flags & 0x80000000)) continue;
    const end = section.rawOffset + section.rawSize;
    let at = section.rawOffset;
    while (at + 4 <= end) {
      const start = at;
      while (
        at + 4 <= end &&
        pe.sections.some(
          (s) =>
            s.executable &&
            bytes.readUInt32LE(at) >= s.va &&
            bytes.readUInt32LE(at) < s.va + Math.min(s.virtualSize, s.rawSize),
        )
      )
        at += 4;
      const count = (at - start) / 4;
      if (count >= 40 && at + 4 <= end && bytes.readUInt32LE(at) === 0)
        result.candidates.push({ va: section.va + start - section.rawOffset, count });
      at = Math.max(at, start + 4);
    }
  }
  // These are structural candidates, with explicit ambiguity and manual review.
  // Restrict the main search to writable, NULL-terminated pointer runs.
  const mains = result.candidates.filter((c) => c.count >= 256).sort((a, b) => b.count - a.count);
  const generic = result.candidates.filter((c) => c.count === 45);
  const pairs = result.candidates
    .filter((c) => c.count === 44)
    .flatMap((first) =>
      result.candidates
        .filter((second) => second.count === 51 && second.va === first.va + 184)
        .map((second) => [first, second]),
    );
  if (
    !mains.length ||
    mains[0].count === mains[1]?.count ||
    generic.length !== 1 ||
    pairs.length !== 1
  ) {
    result.reason = 'Pointer structures do not uniquely identify all four table candidates';
    return result;
  }
  const selected = [mains[0], generic[0], ...pairs[0]];
  result.tables = selected.map((candidate, i) =>
    readPointerTable(
      bytes,
      pe,
      ['main', 'generic', 'particle-v1', 'particle-v2'][i],
      candidate.va,
      candidate.count,
    ),
  );
  result.status = 'candidate';
  result.reason =
    'Writable pointer runs and adjacent 44/51 particle tables. Registration requires review.';
  return result;
}

export function parseDisassembly(text) {
  const instructions = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*([\da-f]+):\s+((?:[\da-f]{2}\s+)+)\s*(\S+)(?:\s+(.*))?$/i.exec(line);
    if (!match) continue;
    const address = parseInt(match[1], 16),
      bytes = match[2].trim().split(/\s+/);
    instructions.set(address, {
      address,
      size: bytes.length,
      bytes: bytes.join(''),
      op: match[3],
      operands: (match[4] ?? '').replace(/\s+#.*$/, '').trim(),
    });
  }
  return instructions;
}

function referencedString(bytes, pe, address) {
  if (pe.executable(address)) return null;
  let at;
  try {
    at = pe.offset(address);
  } catch {
    return null;
  }
  const end = bytes.indexOf(0, at);
  if (end < at + 4 || end > at + 120) return null;
  const value = bytes.subarray(at, end);
  return value.every((byte) => byte >= 32 && byte < 127) ? value.toString('ascii') : null;
}

function normalize(instruction, bytes, pe, local = new Map()) {
  return `${instruction.op} ${instruction.operands.replace(/0x[\da-f]+/gi, (value) => {
    const address = parseInt(value, 16);
    if (local.has(address) && /^j/.test(instruction.op)) return `block${local.get(address)}`;
    const section = pe.sections.find((s) => address >= s.va && address < s.va + s.virtualSize);
    if (!section) return value;
    const string = referencedString(bytes, pe, address);
    return string ? `string(${JSON.stringify(string)})` : section.executable ? '@code' : '@data';
  })}`;
}

function successors(instruction) {
  const next = instruction.address + instruction.size;
  if (/^(ret|int3|ud2)/.test(instruction.op)) return [];
  if (/^j/.test(instruction.op)) {
    const target = /^0x[\da-f]+$/.test(instruction.operands) ? Number(instruction.operands) : null;
    return instruction.op === 'jmp' ? [target] : [next, target];
  }
  return [next];
}

function controlSites(body, instructions) {
  const pending = [[body[0].address, null]],
    seen = new Set(),
    returns = new Set();
  const allowed = new Set(body.map((i) => i.address));
  let unknown = false;
  while (pending.length) {
    const [address, input] = pending.pop(),
      key = `${address}/${input}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const instruction = instructions.get(address);
    if (!allowed.has(address) || !instruction) {
      unknown = true;
      continue;
    }
    const { op, operands } = instruction;
    let value = input;
    if (/^mov\s*$/.test(op) && /^eax,0x[\da-f]+$/.test(operands)) value = Number(operands.slice(4));
    else if (op === 'xor' && operands === 'eax,eax') value = 0;
    else if (
      op === 'call' ||
      /^(mul|div|idiv|imul|popa)/.test(op) ||
      (!/^(cmp|test|push|j|ret)/.test(op) && /^(eax|ax|al|ah)[,\s]/.test(operands))
    )
      value = null;
    if (/^ret/.test(op)) {
      if (value === null || value < 0 || value > 5) unknown = true;
      else returns.add(value);
    }
    for (const next of successors(instruction)) pending.push([next, value]);
  }
  return { candidates: [...returns].sort(), unknown };
}

function argumentReads(body) {
  // Only direct argv accesses before the first branch/call are evidence here.
  // The universal handler receives VM, task, argv, output. No argc is encoded.
  const roots = new Set(),
    offsets = new Set();
  let stack = 0;
  for (const { op, operands } of body) {
    if (/^(j|ret|call)/.test(op)) break;
    const argv = /^([a-z]+),DWORD PTR \[esp\+0x([\da-f]+)\]$/.exec(operands);
    for (const root of roots) {
      const match = new RegExp(`\\[${root}(?:\\+0x([\\da-f]+))?\\]`).exec(operands);
      if (match) offsets.add(parseInt(match[1] ?? '0', 16));
    }
    const destination = /^([a-z]+),/.exec(operands)?.[1];
    if (destination && !/^(cmp|test)/.test(op)) roots.delete(destination);
    if (op === 'mov' && argv && parseInt(argv[2], 16) === stack + 12) roots.add(argv[1]);
    if (op === 'push') stack += 4;
    else if (op === 'pop') {
      roots.delete(operands);
      stack -= 4;
    } else if (/^(sub|add)$/.test(op) && /^esp,0x/.test(operands))
      stack += (op === 'sub' ? 1 : -1) * Number(operands.slice(4));
  }
  return [...offsets].sort((a, b) => a - b);
}

export function inspectHandler(bytes, pe, instructions, address) {
  const pending = [address],
    found = new Map();
  let complete = true;
  while (pending.length) {
    const at = pending.pop();
    if (found.has(at)) continue;
    const instruction = instructions.get(at);
    if (
      !instruction ||
      at < address ||
      at >= address + 4096 ||
      found.size >= 512 ||
      instruction.op === '(bad)' ||
      instruction.op === '.byte'
    ) {
      complete = false;
      continue;
    }
    found.set(at, instruction);
    pending.push(...successors(instruction));
  }
  const body = [...found.values()].sort((a, b) => a.address - b.address);
  if (!body.length) return { review: 'needs-review', reason: 'No decoded handler entry' };
  const local = new Map(body.map((i, index) => [i.address, index])),
    strings = new Set(),
    calls = [];
  for (const instruction of body) {
    for (const match of instruction.operands.matchAll(/0x[\da-f]+/gi)) {
      const text = referencedString(bytes, pe, Number(match[0]));
      if (text) strings.add(text);
    }
    if (instruction.op === 'call' && /^0x[\da-f]+$/.test(instruction.operands)) {
      let next = Number(instruction.operands);
      const preview = [];
      for (let i = 0; i < 16 && instructions.has(next); i++) {
        const item = instructions.get(next);
        preview.push(normalize(item, bytes, pe));
        if (/^(ret|jmp|int3)/.test(item.op)) break;
        next += item.size;
      }
      calls.push(digest(preview.join('\n')));
    }
  }
  const pattern = body.map((i) => normalize(i, bytes, pe, local)),
    controls = controlSites(body, instructions);
  return {
    review: 'needs-review',
    complete,
    instructions: body.length,
    rawFingerprint: digest(body.map((i) => i.bytes).join('')),
    structuralFingerprint: digest(pattern.join('\n')),
    contextFingerprint: digest([...pattern, ...calls].join('\n')),
    pattern,
    callAnchors: calls,
    strings: [...strings],
    // Static observations are not reviewed ABI declarations. Missing types stay
    // unknown here; no structured ABI signature is inferred from prefix reads.
    signature: {
      parameters: null,
      types: null,
      directArgumentByteOffsets: argumentReads(body),
      controlCodes: controls.candidates,
      controlsComplete: complete && !controls.unknown,
      reason:
        'Static return sites and direct argv reads are partial observations. Exact arity/types require review.',
    },
  };
}

export async function extractNativeABI(path) {
  const bytes = await readFile(path),
    inventory = inspectNativeTables(bytes);
  if (!inventory.tables.length) return inventory;
  const { stdout } = await run('objdump', ['-d', '-w', '-M', 'intel', '--', path], {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 120000,
  });
  const instructions = parseDisassembly(stdout),
    pe = readPE(bytes),
    handlers = new Map();
  for (const table of inventory.tables)
    for (const entry of table.entries) {
      if (!handlers.has(entry.handlerVA))
        handlers.set(
          entry.handlerVA,
          inspectHandler(bytes, pe, instructions, Number(entry.handlerVA)),
        );
      entry.handler = handlers.get(entry.handlerVA);
    }
  return {
    ...inventory,
    disassembler: 'objdump -d -w -M intel',
    limitations: [
      'Structural table candidates require review.',
      'CFG bounded to 512 instructions and 4096 forward bytes. External tails remain unresolved.',
      'Pointer normalization loses data identity. Matching is candidate evidence, not behavioral proof.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, output] = process.argv.slice(2);
  if (!path || !output)
    throw new Error('Usage: node scripts/extract-native-abi.mjs EXE OUTPUT_JSON');
  await writeFile(output, `${JSON.stringify(await extractNativeABI(resolve(path)), null, 2)}\n`);
}
