// Tests for the archive row parsers the restore path feeds the database from.
// Run: node server/backupArchive.test.mjs
//
// These are the pieces that replaced JSON.parse-the-whole-table, so the risk
// they cover is a subtly mis-parsed row silently corrupting a restore.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { rowsFromJsonl, rowsFromJsonArray } from './backupArchive.js';

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
}

// Feeds text through in fixed-size slices so the parsers have to cope with
// rows split across chunk boundaries.
function chunked(text, size) {
  const buf = Buffer.from(text, 'utf8');
  return Readable.from((function* slices() {
    for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
  })());
}

async function collect(iterable) {
  const rows = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

console.log('backupArchive');

const sample = [
  { id: 'p1', name: 'U1-03', note: 'has "quotes", {braces} and [brackets]' },
  { id: 'p2', name: 'H2D-01', nested: { spools: [{ tray: 0 }, { tray: 1 }] } },
  { id: 'p3', name: 'ยูนิต ๓', file: { __bytea__: Buffer.from('hello').toString('base64') } },
];

await check('parses JSONL rows across chunk boundaries', async () => {
  const text = `${sample.map((row) => JSON.stringify(row)).join('\n')}\n`;
  for (const size of [1, 3, 17, 4096]) {
    assert.deepEqual(await collect(rowsFromJsonl(chunked(text, size))), sample);
  }
});

await check('tolerates a JSONL file with no trailing newline', async () => {
  const text = sample.map((row) => JSON.stringify(row)).join('\n');
  assert.deepEqual(await collect(rowsFromJsonl(chunked(text, 5))), sample);
});

await check('yields nothing for an empty JSONL entry', async () => {
  assert.deepEqual(await collect(rowsFromJsonl(chunked('', 4))), []);
  assert.deepEqual(await collect(rowsFromJsonl(chunked('\n\n', 1))), []);
});

await check('parses a v1 JSON array one row at a time', async () => {
  const text = JSON.stringify(sample);
  for (const size of [1, 2, 7, 64, 100000]) {
    assert.deepEqual(await collect(rowsFromJsonArray(chunked(text, size))), sample);
  }
});

await check('parses a pretty-printed v1 array', async () => {
  const text = `\n  ${JSON.stringify(sample, null, 2)}\n`;
  assert.deepEqual(await collect(rowsFromJsonArray(chunked(text, 13))), sample);
});

await check('handles escaped quotes and braces inside v1 strings', async () => {
  const rows = [{ v: 'a\\"b' }, { v: '}]{[' }, { v: '\\\\' }];
  const text = JSON.stringify(rows);
  assert.deepEqual(await collect(rowsFromJsonArray(chunked(text, 3))), rows);
});

await check('yields nothing for an empty v1 array', async () => {
  assert.deepEqual(await collect(rowsFromJsonArray(chunked('[]', 1))), []);
  assert.deepEqual(await collect(rowsFromJsonArray(chunked('[\n]', 1))), []);
});

await check('rejects table data that is not an array', async () => {
  await assert.rejects(
    () => collect(rowsFromJsonArray(chunked('{"not":"an array"}', 4))),
    /not a JSON array/,
  );
});

console.log(`\n${passed} backupArchive assertions passed${process.exitCode ? ' (with failures)' : ' ✅'}`);
