// Tests for the archive row parsers the restore path feeds the database from.
// Run: node server/backupArchive.test.mjs
//
// These are the pieces that replaced JSON.parse-the-whole-table, so the risk
// they cover is a subtly mis-parsed row silently corrupting a restore.

import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { rowsFromJsonl, rowsFromJsonArray, restoreBackupArchive } from './backupArchive.js';
import { ZipStreamWriter, METHOD_STORE } from './zipStream.js';
import { reviveRestoreValue } from './postgres.js';

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

// ── Whole-archive restore, against a recording stub instead of Postgres ──────
// Covers what the route actually does with an uploaded file: which tables get
// rows, in which order, and how each stored model file is reassembled.

const dir = await mkdtemp(path.join(tmpdir(), 'backup-restore-test-'));

function recordingSession(tables) {
  const inserted = new Map();
  const blobs = new Map();
  return {
    session: {
      tables,
      async insertRows(table, rows) {
        if (!inserted.has(table)) inserted.set(table, []);
        // Mirror what the real session does to each value before it hits SQL.
        inserted.get(table).push(...rows.map((row) => {
          const out = {};
          for (const [column, value] of Object.entries(row)) out[column] = reviveRestoreValue(value);
          return out;
        }));
      },
      async writeBlobChunk(table, key, column, chunk, first) {
        const id = `${table}|${JSON.stringify(key)}|${column}`;
        if (first || !blobs.has(id)) blobs.set(id, []);
        blobs.get(id).push(chunk);
      },
      async commit() { this.committed = true; },
      async abort() { this.aborted = true; },
    },
    inserted,
    blob(table, key, column) {
      const chunks = blobs.get(`${table}|${JSON.stringify(key)}|${column}`);
      return chunks ? Buffer.concat(chunks) : null;
    },
  };
}

async function buildArchive(name, build) {
  const filePath = path.join(dir, name);
  const out = createWriteStream(filePath);
  const zip = new ZipStreamWriter(out);
  await build(zip);
  await zip.finish();
  out.end();
  await once(out, 'close');
  return filePath;
}

const modelFile = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256));

try {
  await check('restores a v2 archive, reassembling stored model files', async () => {
    const filePath = await buildArchive('v2.zip', async (zip) => {
      await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify({
        formatVersion: 2,
        generatedAt: '2026-08-09T00:00:00.000Z',
        tables: [{ name: 'printers', rowCount: 1 }, { name: 'queue_jobs', rowCount: 2 }],
      })));
      await zip.addEntry('tables/printers.jsonl', [Buffer.from('{"id":"p1","name":"U1-03"}\n')]);
      await zip.addEntry('tables/queue_jobs.jsonl', [Buffer.from(
        `${JSON.stringify({
          id: 'j1',
          file_content: { __blob__: 'blobs/queue_jobs/0-file_content.bin', bytes: modelFile.length, key: { id: 'j1' } },
        })}\n${JSON.stringify({ id: 'j2', file_content: null })}\n`,
      )]);
      await zip.addEntry('blobs/queue_jobs/0-file_content.bin', [modelFile], {
        method: METHOD_STORE,
        expectedSize: modelFile.length,
      });
    });

    const stub = recordingSession(['printers', 'queue_jobs']);
    const result = await restoreBackupArchive(filePath, { createSession: async () => stub.session });

    assert.equal(stub.session.committed, true);
    assert.equal(stub.session.aborted, undefined);
    assert.deepEqual(result.tables, [{ name: 'printers', rowCount: 1 }, { name: 'queue_jobs', rowCount: 2 }]);
    assert.deepEqual(stub.inserted.get('printers'), [{ id: 'p1', name: 'U1-03' }]);
    // The marker is inserted as NULL; the bytes arrive on the blob pass.
    assert.deepEqual(stub.inserted.get('queue_jobs'), [
      { id: 'j1', file_content: null },
      { id: 'j2', file_content: null },
    ]);
    assert.ok(stub.blob('queue_jobs', { id: 'j1' }, 'file_content').equals(modelFile));
  });

  await check('restores a v1 archive with inline base64 file bytes', async () => {
    // The shape the previous implementation wrote: store-only entries, one JSON
    // array per table, every bytea inlined as { __bytea__: base64 }.
    const filePath = await buildArchive('v1.zip', async (zip) => {
      await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        appVersion: 'old',
        tables: [{ name: 'printers', rowCount: 1 }, { name: 'queue_jobs', rowCount: 1 }],
      })), { method: METHOD_STORE });
      await zip.addEntry('tables/printers.json', [Buffer.from(JSON.stringify([{ id: 'p1', name: 'U1-03' }]))], {
        method: METHOD_STORE,
      });
      await zip.addEntry('tables/queue_jobs.json', [Buffer.from(JSON.stringify([
        { id: 'j1', file_content: { __bytea__: modelFile.toString('base64') } },
      ]))], { method: METHOD_STORE });
    });

    const stub = recordingSession(['printers', 'queue_jobs']);
    const result = await restoreBackupArchive(filePath, { createSession: async () => stub.session });

    assert.equal(stub.session.committed, true);
    assert.deepEqual(result.tables, [{ name: 'printers', rowCount: 1 }, { name: 'queue_jobs', rowCount: 1 }]);
    assert.deepEqual(stub.inserted.get('printers'), [{ id: 'p1', name: 'U1-03' }]);
    // v1 keeps the bytes in the row itself — they must arrive as a Buffer.
    const [job] = stub.inserted.get('queue_jobs');
    assert.equal(job.id, 'j1');
    assert.ok(Buffer.isBuffer(job.file_content));
    assert.ok(job.file_content.equals(modelFile));
  });

  await check('inserts tables in backup-set order, not archive order', async () => {
    // filament_station_assignments carries this schema's only foreign keys, so
    // it has to be inserted after the rows it points at even if the archive
    // lists it first.
    const filePath = await buildArchive('order.zip', async (zip) => {
      await zip.addBuffer('manifest.json', Buffer.from('{"formatVersion":2}'));
      await zip.addEntry('tables/filament_station_assignments.jsonl', [Buffer.from('{"id":"a1"}\n')]);
      await zip.addEntry('tables/printers.jsonl', [Buffer.from('{"id":"p1"}\n')]);
    });

    const order = [];
    const stub = recordingSession(['printers', 'filament_station_assignments']);
    const recording = {
      ...stub.session,
      async insertRows(table, rows) {
        order.push(table);
        await stub.session.insertRows(table, rows);
      },
    };
    await restoreBackupArchive(filePath, { createSession: async () => recording });
    assert.deepEqual(order, ['printers', 'filament_station_assignments']);
  });

  await check('rolls back and reports a corrupt archive entry', async () => {
    const filePath = await buildArchive('bad.zip', async (zip) => {
      await zip.addBuffer('manifest.json', Buffer.from('{"formatVersion":2}'));
      await zip.addEntry('tables/printers.jsonl', [Buffer.from('{"id":"p1"\n')]); // truncated JSON
    });

    const stub = recordingSession(['printers']);
    await assert.rejects(
      () => restoreBackupArchive(filePath, { createSession: async () => stub.session }),
      /Corrupt archive entry/,
    );
    assert.equal(stub.session.aborted, true);
    assert.equal(stub.session.committed, undefined);
  });

  await check('rejects an archive with no manifest', async () => {
    const filePath = await buildArchive('nomanifest.zip', async (zip) => {
      await zip.addEntry('tables/printers.jsonl', [Buffer.from('{"id":"p1"}\n')]);
    });
    await assert.rejects(
      () => restoreBackupArchive(filePath, { createSession: async () => recordingSession(['printers']).session }),
      /missing manifest.json/,
    );
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${passed} backupArchive assertions passed${process.exitCode ? ' (with failures)' : ' ✅'}`);
