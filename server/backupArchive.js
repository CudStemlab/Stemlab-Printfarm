// Backup archive I/O for the admin restore path: spool the upload to disk,
// then walk it entry by entry into the database.
//
// The point of this module is that neither the archive nor any table's rows are
// ever fully resident. The upload lands in a temp file (bounded by disk, not
// RAM), the ZIP is read through its central directory, table rows arrive as a
// stream of JSON lines fed to the restore session in batches, and each stored
// model file is appended to its row in slices. Peak memory is a few MB
// regardless of how big the farm's data has grown — the old path parsed the
// whole archive into one object graph and routinely exhausted the container.

import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';

import { openZipFile } from './zipStream.js';
import { startBackupRestore } from './postgres.js';
import { logger } from './logger.js';

// Rows handed to the restore session at a time (it batches its own INSERTs
// under this).
const RESTORE_ROW_BATCH = 500;
// Model-file bytes buffered before appending to the row. Appending to a bytea
// rewrites the whole value, so bigger slices mean fewer rewrites; 8 MB keeps
// both resident memory and write amplification modest.
const BLOB_WRITE_CHUNK_BYTES = 8 * 1024 * 1024;

// A malformed/unsupported archive — the route turns this into a 400, as
// opposed to a genuine server error.
export class BackupArchiveError extends Error {}

// Streams the request body into a temp file, enforcing `maxBytes` as it goes so
// an oversized upload is rejected without ever being held. Returns the temp
// file's path plus a cleanup function; the caller must always call cleanup().
export async function spoolRequestToTempFile(req, maxBytes, { dir = process.env.BACKUP_TMP_DIR } = {}) {
  const directory = await mkdtemp(path.join(dir || tmpdir(), 'printfarm-restore-'));
  const filePath = path.join(directory, 'archive.zip');
  const cleanup = async () => { await rm(directory, { recursive: true, force: true }).catch(() => {}); };

  let size = 0;
  let tooLarge = false;
  const limiter = async function* limit(source) {
    for await (const chunk of source) {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        throw new BackupArchiveError('Request body is too large');
      }
      yield chunk;
    }
  };

  try {
    await pipeline(req, limiter, createWriteStream(filePath));
  } catch (error) {
    await cleanup();
    if (tooLarge) {
      const err = new BackupArchiveError('Request body is too large');
      err.tooLarge = true;
      throw err;
    }
    throw error;
  }

  return { path: filePath, size, cleanup };
}

async function readEntryText(zip, entry) {
  const chunks = [];
  for await (const chunk of await zip.readEntry(entry)) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// v2 rows: one JSON object per line. StringDecoder so a multi-byte character
// split across two chunks isn't mangled. (Exported for backupArchive.test.mjs.)
export async function* rowsFromJsonl(stream) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.write(chunk);
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line);
      newline = buffer.indexOf('\n');
    }
  }
  const tail = (buffer + decoder.end()).trim();
  if (tail) yield JSON.parse(tail);
}

// v1 rows: one big JSON array per table. Rather than JSON.parse the whole
// thing (the behaviour that made restoring an old archive a memory spike),
// scan the text and hand back one top-level element at a time. Only a single
// element is ever held — which for v1 still means one row's inlined base64
// file, but never the whole table. (Exported for backupArchive.test.mjs.)
export async function* rowsFromJsonArray(stream) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let pos = 0;
  let arrayOpened = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let elementStart = -1;
  let done = false;

  function* scan() {
    while (pos < buffer.length) {
      const ch = buffer[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (!arrayOpened) {
        if (ch === '[') arrayOpened = true;
        else if (!/\s/.test(ch)) throw new BackupArchiveError('Table data is not a JSON array');
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        if (depth === 0) elementStart = pos;
        depth += 1;
      } else if (ch === '}' || ch === ']') {
        if (depth === 0) {
          done = true; // closing bracket of the outer array
          pos = buffer.length;
          break;
        }
        depth -= 1;
        if (depth === 0) {
          const text = buffer.slice(elementStart, pos + 1);
          elementStart = -1;
          buffer = buffer.slice(pos + 1);
          pos = 0;
          yield JSON.parse(text);
          continue;
        }
      }
      pos += 1;
    }
    // Between elements nothing scanned so far is needed any more, so the
    // buffer never grows past the current element.
    if (depth === 0 && elementStart === -1) {
      buffer = buffer.slice(pos);
      pos = 0;
    }
  }

  for await (const chunk of stream) {
    if (done) break;
    buffer += decoder.write(chunk);
    yield* scan();
  }
  if (!done) {
    buffer += decoder.end();
    yield* scan();
  }
}

function tableNameFromEntry(name) {
  const base = name.slice('tables/'.length);
  return base.replace(/\.(jsonl|json)$/, '');
}

// Restores a backup archive at `archivePath`. Everything happens inside the
// restore session's single transaction: on any failure the session is rolled
// back, so a bad archive leaves the database untouched.
export async function restoreBackupArchive(archivePath) {
  let zip;
  try {
    zip = await openZipFile(archivePath);
  } catch (error) {
    throw new BackupArchiveError(`Not a valid backup archive: ${error.message}`);
  }

  try {
    const manifestEntry = zip.entries.find((entry) => entry.name === 'manifest.json');
    const tableEntries = zip.entries.filter(
      (entry) => entry.name.startsWith('tables/') && /\.(jsonl|json)$/.test(entry.name),
    );
    const blobEntries = zip.entries.filter((entry) => entry.name.startsWith('blobs/'));

    let manifest = null;
    if (manifestEntry) {
      try {
        manifest = JSON.parse(await readEntryText(zip, manifestEntry));
      } catch (error) {
        throw new BackupArchiveError(`Corrupt manifest.json: ${error.message}`);
      }
    }
    if (!manifest || tableEntries.length === 0) {
      throw new BackupArchiveError('Backup archive is missing manifest.json or table data.');
    }

    const session = await startBackupRestore(tableEntries.map((entry) => tableNameFromEntry(entry.name)));
    // Insert in the order the backup set defines, not the order the archive
    // happens to list: filament_station_assignments carries this schema's only
    // foreign keys and must land after the rows it points at.
    tableEntries.sort(
      (a, b) => session.tables.indexOf(tableNameFromEntry(a.name))
        - session.tables.indexOf(tableNameFromEntry(b.name)),
    );
    const restored = [];
    // Blob entry path → the row/column it belongs to, collected as rows stream
    // past (the marker in the row carries its own primary key).
    const blobTargets = new Map();

    try {
      for (const entry of tableEntries) {
        const table = tableNameFromEntry(entry.name);
        if (!session.tables.includes(table)) {
          logger.warn('backup restore: ignoring unrecognized table in archive', { table });
          continue;
        }

        const stream = await zip.readEntry(entry);
        const rows = entry.name.endsWith('.jsonl') ? rowsFromJsonl(stream) : rowsFromJsonArray(stream);

        let rowCount = 0;
        let batch = [];
        try {
          for await (const row of rows) {
            for (const [column, value] of Object.entries(row)) {
              if (value && typeof value === 'object' && typeof value.__blob__ === 'string') {
                blobTargets.set(value.__blob__, { table, column, key: value.key });
              }
            }
            batch.push(row);
            rowCount += 1;
            if (batch.length >= RESTORE_ROW_BATCH) {
              await session.insertRows(table, batch);
              batch = [];
            }
          }
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new BackupArchiveError(`Corrupt archive entry "${entry.name}": ${error.message}`);
          }
          throw error;
        }
        if (batch.length > 0) await session.insertRows(table, batch);
        restored.push({ name: table, rowCount });
      }

      for (const entry of blobEntries) {
        const target = blobTargets.get(entry.name);
        if (!target) {
          logger.warn('backup restore: archive blob has no matching row', { entry: entry.name });
          continue;
        }
        let pending = [];
        let pendingBytes = 0;
        let first = true;
        const flush = async () => {
          if (pendingBytes === 0) return;
          await session.writeBlobChunk(target.table, target.key, target.column, Buffer.concat(pending), first);
          first = false;
          pending = [];
          pendingBytes = 0;
        };
        for await (const chunk of await zip.readEntry(entry)) {
          pending.push(chunk);
          pendingBytes += chunk.length;
          if (pendingBytes >= BLOB_WRITE_CHUNK_BYTES) await flush();
        }
        await flush();
      }

      await session.commit();
    } catch (error) {
      await session.abort();
      throw error;
    }

    return { manifest, tables: restored };
  } finally {
    await zip.close().catch(() => {});
  }
}
