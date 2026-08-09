// Round-trip tests for the streaming ZIP writer/reader that backups ride on.
// Run: node server/zipStream.test.mjs
//
// Nothing here touches Postgres — it exercises the archive format itself,
// including the store-only shape older (v1) backups were written in.

import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

import { ZipStreamWriter, openZipFile, METHOD_STORE } from './zipStream.js';

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      console.error(`  ✗ ${name}\n    ${error.message}`);
      process.exitCode = 1;
    });
}

async function writeArchive(dir, build) {
  const filePath = path.join(dir, `archive-${Math.random().toString(36).slice(2)}.zip`);
  const out = createWriteStream(filePath);
  const zip = new ZipStreamWriter(out);
  await build(zip);
  await zip.finish();
  out.end();
  await once(out, 'close');
  return filePath;
}

async function readEntry(zip, name) {
  const entry = zip.entries.find((candidate) => candidate.name === name);
  assert.ok(entry, `entry ${name} is missing`);
  const chunks = [];
  for await (const chunk of await zip.readEntry(entry)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const dir = await mkdtemp(path.join(tmpdir(), 'zipstream-test-'));

try {
  console.log('zipStream');

  await check('round-trips deflated and stored entries', async () => {
    const text = 'x'.repeat(100_000);
    const binary = Buffer.from(Array.from({ length: 50_000 }, (_, i) => i % 256));
    const filePath = await writeArchive(dir, async (zip) => {
      await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify({ formatVersion: 2 })));
      await zip.addEntry('tables/printers.jsonl', [Buffer.from(text)]);
      await zip.addEntry('blobs/queue_jobs/0-file_content.bin', [binary], {
        method: METHOD_STORE,
        expectedSize: binary.length,
      });
    });

    const zip = await openZipFile(filePath);
    try {
      assert.equal(zip.entries.length, 3);
      assert.deepEqual(JSON.parse(await readEntry(zip, 'manifest.json')), { formatVersion: 2 });
      assert.equal((await readEntry(zip, 'tables/printers.jsonl')).toString('utf8'), text);
      assert.ok((await readEntry(zip, 'blobs/queue_jobs/0-file_content.bin')).equals(binary));
    } finally {
      await zip.close();
    }
  });

  await check('compresses repetitive table data', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ id: `p${i}`, status: 'idle' })).join('\n');
    const filePath = await writeArchive(dir, async (zip) => {
      await zip.addEntry('tables/printers.jsonl', [Buffer.from(rows)]);
    });
    const archiveSize = (await readFile(filePath)).length;
    assert.ok(archiveSize < rows.length / 4, `archive (${archiveSize}) should be far smaller than ${rows.length}`);
  });

  await check('streams many chunks without holding them', async () => {
    // 64 MiB in 1 MiB chunks — the writer must never accumulate the entry.
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const chunkCount = 64;
    const filePath = await writeArchive(dir, async (zip) => {
      await zip.addEntry('blobs/big.bin', (function* source() {
        for (let i = 0; i < chunkCount; i++) yield chunk;
      })(), { method: METHOD_STORE, expectedSize: chunk.length * chunkCount });
    });

    const zip = await openZipFile(filePath);
    try {
      const entry = zip.entries.find((candidate) => candidate.name === 'blobs/big.bin');
      assert.equal(entry.uncompressedSize, chunk.length * chunkCount);
      let seen = 0;
      for await (const piece of await zip.readEntry(entry)) seen += piece.length;
      assert.equal(seen, chunk.length * chunkCount);
    } finally {
      await zip.close();
    }
  });

  await check('reads a store-only archive written the v1 way', async () => {
    // Mirrors the old in-memory builder: method 0, sizes in the local header,
    // no data descriptor.
    const name = Buffer.from('tables/app_settings.json', 'utf8');
    const data = Buffer.from('[{"key":"branding","value":{}}]', 'utf8');
    const crcTable = (() => {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
      }
      return table;
    })();
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);

    const localBlock = Buffer.concat([local, name, data]);
    const centralBlock = Buffer.concat([central, name]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralBlock.length, 12);
    eocd.writeUInt32LE(localBlock.length, 16);

    const filePath = path.join(dir, 'legacy.zip');
    await writeFile(filePath, Buffer.concat([localBlock, centralBlock, eocd]));

    const zip = await openZipFile(filePath);
    try {
      assert.equal(zip.entries.length, 1);
      assert.equal((await readEntry(zip, 'tables/app_settings.json')).toString('utf8'), data.toString('utf8'));
    } finally {
      await zip.close();
    }
  });

  await check('rejects a corrupted entry instead of restoring garbage', async () => {
    const filePath = await writeArchive(dir, async (zip) => {
      await zip.addEntry('tables/printers.jsonl', [Buffer.from('{"id":"p1"}\n')], { method: METHOD_STORE });
    });
    const bytes = await readFile(filePath);
    // Flip a byte inside the stored payload (right after the local header).
    const payloadStart = 30 + Buffer.from('tables/printers.jsonl').length;
    bytes[payloadStart] ^= 0xff;
    const corruptPath = path.join(dir, 'corrupt.zip');
    await writeFile(corruptPath, bytes);

    const zip = await openZipFile(corruptPath);
    try {
      await assert.rejects(async () => {
        for await (const _chunk of await zip.readEntry(zip.entries[0])) { /* drain */ }
      }, /CRC mismatch/);
    } finally {
      await zip.close();
    }
  });

  await check('archives are readable by an external unzip implementation', async () => {
    let python = null;
    try {
      execFileSync('python3', ['-c', 'import zipfile'], { stdio: 'ignore' });
      python = 'python3';
    } catch {
      console.log('    (skipped — python3 unavailable)');
      return;
    }

    const payload = zlib.gzipSync(Buffer.from('already compressed')); // exercises store-ish data
    const filePath = await writeArchive(dir, async (zip) => {
      await zip.addBuffer('manifest.json', Buffer.from('{"formatVersion":2}'));
      await zip.addEntry('tables/printers.jsonl', [Buffer.from('{"id":"p1"}\n{"id":"p2"}\n')]);
      await zip.addEntry('blobs/x.bin', [payload], { method: METHOD_STORE, expectedSize: payload.length });
    });

    const script = `
import json, zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None, "testzip reported a bad entry"
    assert json.loads(z.read("manifest.json"))["formatVersion"] == 2
    assert z.read("tables/printers.jsonl").decode().count("\\n") == 2
    print(len(z.read("blobs/x.bin")))
`;
    const out = execFileSync(python, ['-c', script, filePath], { encoding: 'utf8' }).trim();
    assert.equal(Number(out), payload.length);
  });

  console.log(`\n${passed} zipStream assertions passed${process.exitCode ? ' (with failures)' : ' ✅'}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
