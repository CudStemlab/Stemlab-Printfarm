// Streaming ZIP writer + random-access ZIP reader — no external dependencies.
//
// Why this exists next to zipArchive.js: that module assembles a whole archive
// in one Buffer (every entry concatenated), which makes peak RAM a multiple of
// the data size. Backups carry every stored queue-job model file, so that model
// crashed the server once the farm accumulated real data. Here nothing larger
// than one chunk is ever resident:
//
//   * the writer pushes each entry straight into a Writable (the HTTP
//     response), deflating as it goes, and never needs to know an entry's size
//     up front — sizes/CRC go into a trailing data descriptor (ZIP spec 4.3.9),
//     which is what makes streaming possible at all;
//   * the reader works off the central directory of a file on disk, so each
//     entry is a plain fs read stream at a byte range.
//
// Supports store (method 0) and deflate (method 8) so archives written by the
// old in-memory builder still read back. ZIP64 fields are emitted only when a
// size/offset/count actually overflows the classic 32-bit fields, so ordinary
// archives stay maximally compatible.

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import zlib from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const DATA_DESCRIPTOR_SIG = 0x08074b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

// Flag bit 3: sizes/CRC live in a trailing data descriptor, not the local header.
const FLAG_DATA_DESCRIPTOR = 0x0008;
// Flag bit 11: file name is UTF-8.
const FLAG_UTF8 = 0x0800;

export const METHOD_STORE = 0;
export const METHOD_DEFLATE = 8;

// CRC-32 (IEEE 802.3 polynomial) — required by the ZIP format.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc, buf) {
  let c = crc;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function dosDateTime(date) {
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) >>> 0;
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) >>> 0;
  return { dosDate, dosTime };
}

function writeUInt64LE(buf, value, offset) {
  buf.writeBigUInt64LE(BigInt(value), offset);
}

// ── Writer ───────────────────────────────────────────────────────────────────

// Writes a ZIP into `out` (any Writable — an HTTP response, a file stream)
// entry by entry. Usage:
//
//   const zip = new ZipStreamWriter(res);
//   await zip.addEntry('tables/printers.jsonl', asyncIterableOfBuffers);
//   await zip.finish();
//
// Every write honours backpressure, so a slow client throttles the producer
// instead of queueing the archive in the socket's write buffer.
export class ZipStreamWriter {
  constructor(out, { level = zlib.constants.Z_DEFAULT_COMPRESSION } = {}) {
    this.out = out;
    this.level = level;
    this.offset = 0;
    this.entries = [];
    this.finished = false;
    const { dosDate, dosTime } = dosDateTime(new Date());
    this.dosDate = dosDate;
    this.dosTime = dosTime;
  }

  async #write(buf) {
    if (!this.out.write(buf)) await once(this.out, 'drain');
    this.offset += buf.length;
  }

  // `source` is an async (or sync) iterable of Buffers. `expectedSize` is only
  // a hint: pass it when the size is known (a bytea column's octet_length) so
  // an entry over 4 GiB gets ZIP64 sizes in its local header/data descriptor.
  // `method` defaults to deflate; pass METHOD_STORE for already-compressed data.
  async addEntry(name, source, { method = METHOD_DEFLATE, expectedSize = null, level = this.level } = {}) {
    if (this.finished) throw new Error('ZipStreamWriter: archive already finished');

    const nameBytes = Buffer.from(name, 'utf8');
    const zip64 = expectedSize !== null && expectedSize >= U32_MAX;
    const localHeaderOffset = this.offset;

    const extraLength = zip64 ? 20 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4); // version needed (45 = ZIP64)
    local.writeUInt16LE(FLAG_DATA_DESCRIPTOR | FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(this.dosTime, 10);
    local.writeUInt16LE(this.dosDate, 12);
    local.writeUInt32LE(0, 14); // crc — in the data descriptor
    local.writeUInt32LE(zip64 ? U32_MAX : 0, 18); // compressed size — ditto
    local.writeUInt32LE(zip64 ? U32_MAX : 0, 22); // uncompressed size — ditto
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extraLength, 28);
    await this.#write(local);
    await this.#write(nameBytes);
    if (zip64) {
      const extra = Buffer.alloc(20);
      extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
      extra.writeUInt16LE(16, 2);
      writeUInt64LE(extra, 0, 4); // uncompressed size placeholder
      writeUInt64LE(extra, 0, 12); // compressed size placeholder
      await this.#write(extra);
    }

    let crc = 0xffffffff;
    let uncompressedSize = 0;
    let compressedSize = 0;

    if (method === METHOD_STORE) {
      for await (const chunk of source) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (buf.length === 0) continue;
        crc = crc32Update(crc, buf);
        uncompressedSize += buf.length;
        compressedSize += buf.length;
        await this.#write(buf);
      }
    } else {
      const deflate = zlib.createDeflateRaw({ level });
      // Drain the deflater concurrently with feeding it, so neither side has to
      // buffer the whole entry.
      const drain = (async () => {
        for await (const chunk of deflate) {
          compressedSize += chunk.length;
          await this.#write(chunk);
        }
      })();
      try {
        for await (const chunk of source) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (buf.length === 0) continue;
          crc = crc32Update(crc, buf);
          uncompressedSize += buf.length;
          if (!deflate.write(buf)) await once(deflate, 'drain');
        }
        deflate.end();
      } catch (error) {
        deflate.destroy(error);
        await drain.catch(() => {});
        throw error;
      }
      await drain;
    }

    crc = (crc ^ 0xffffffff) >>> 0;

    const wide = zip64 || uncompressedSize > U32_MAX || compressedSize > U32_MAX;
    const descriptor = Buffer.alloc(wide ? 24 : 16);
    descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIG, 0);
    descriptor.writeUInt32LE(crc, 4);
    if (wide) {
      writeUInt64LE(descriptor, compressedSize, 8);
      writeUInt64LE(descriptor, uncompressedSize, 16);
    } else {
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(uncompressedSize, 12);
    }
    await this.#write(descriptor);

    this.entries.push({
      nameBytes,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      zip64Local: zip64,
    });

    return { name, compressedSize, uncompressedSize };
  }

  // Convenience for small in-memory entries (manifest.json).
  async addBuffer(name, buffer, options = {}) {
    return this.addEntry(name, [buffer], options);
  }

  // Writes the central directory (+ ZIP64 records when anything overflows).
  async finish() {
    if (this.finished) return;
    this.finished = true;

    const centralDirOffset = this.offset;

    for (const entry of this.entries) {
      const needsZip64 = entry.uncompressedSize > U32_MAX
        || entry.compressedSize > U32_MAX
        || entry.localHeaderOffset > U32_MAX;
      const zip64Fields = [];
      if (needsZip64) {
        if (entry.uncompressedSize > U32_MAX) zip64Fields.push(entry.uncompressedSize);
        if (entry.compressedSize > U32_MAX) zip64Fields.push(entry.compressedSize);
        if (entry.localHeaderOffset > U32_MAX) zip64Fields.push(entry.localHeaderOffset);
      }
      const extraLength = needsZip64 ? 4 + zip64Fields.length * 8 : 0;

      const central = Buffer.alloc(46);
      central.writeUInt32LE(CENTRAL_SIG, 0);
      central.writeUInt16LE(needsZip64 || entry.zip64Local ? 45 : 20, 4); // version made by
      central.writeUInt16LE(needsZip64 || entry.zip64Local ? 45 : 20, 6); // version needed
      central.writeUInt16LE(FLAG_DATA_DESCRIPTOR | FLAG_UTF8, 8);
      central.writeUInt16LE(entry.method, 10);
      central.writeUInt16LE(this.dosTime, 12);
      central.writeUInt16LE(this.dosDate, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(Math.min(entry.compressedSize, U32_MAX), 20);
      central.writeUInt32LE(Math.min(entry.uncompressedSize, U32_MAX), 24);
      central.writeUInt16LE(entry.nameBytes.length, 28);
      central.writeUInt16LE(extraLength, 30);
      central.writeUInt16LE(0, 32); // comment length
      central.writeUInt16LE(0, 34); // disk number start
      central.writeUInt16LE(0, 36); // internal attrs
      central.writeUInt32LE(0, 38); // external attrs
      central.writeUInt32LE(Math.min(entry.localHeaderOffset, U32_MAX), 42);

      await this.#write(central);
      await this.#write(entry.nameBytes);
      if (needsZip64) {
        const extra = Buffer.alloc(extraLength);
        extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
        extra.writeUInt16LE(zip64Fields.length * 8, 2);
        zip64Fields.forEach((value, i) => writeUInt64LE(extra, value, 4 + i * 8));
        await this.#write(extra);
      }
    }

    const centralDirSize = this.offset - centralDirOffset;
    const needsZip64End = this.entries.length > U16_MAX
      || centralDirOffset > U32_MAX
      || centralDirSize > U32_MAX;

    if (needsZip64End) {
      const zip64Eocd = Buffer.alloc(56);
      zip64Eocd.writeUInt32LE(ZIP64_EOCD_SIG, 0);
      writeUInt64LE(zip64Eocd, 44, 4); // size of this record minus 12
      zip64Eocd.writeUInt16LE(45, 12); // version made by
      zip64Eocd.writeUInt16LE(45, 14); // version needed
      zip64Eocd.writeUInt32LE(0, 16); // disk number
      zip64Eocd.writeUInt32LE(0, 20); // disk with central dir
      writeUInt64LE(zip64Eocd, this.entries.length, 24);
      writeUInt64LE(zip64Eocd, this.entries.length, 32);
      writeUInt64LE(zip64Eocd, centralDirSize, 40);
      writeUInt64LE(zip64Eocd, centralDirOffset, 48);
      const zip64EocdOffset = this.offset;
      await this.#write(zip64Eocd);

      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
      locator.writeUInt32LE(0, 4); // disk with ZIP64 EOCD
      writeUInt64LE(locator, zip64EocdOffset, 8);
      locator.writeUInt32LE(1, 16); // total disks
      await this.#write(locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(Math.min(this.entries.length, U16_MAX), 8);
    eocd.writeUInt16LE(Math.min(this.entries.length, U16_MAX), 10);
    eocd.writeUInt32LE(Math.min(centralDirSize, U32_MAX), 12);
    eocd.writeUInt32LE(Math.min(centralDirOffset, U32_MAX), 16);
    eocd.writeUInt16LE(0, 20); // comment length
    await this.#write(eocd);
  }
}

// ── Reader ───────────────────────────────────────────────────────────────────

// Verifies CRC-32 as bytes flow through, so a corrupt stored (uncompressed)
// entry fails loudly instead of silently restoring garbage. Deflate entries are
// already integrity-checked by zlib, but the CRC covers them too.
class Crc32Check extends Transform {
  constructor(expected, name) {
    super();
    this.expected = expected;
    this.name = name;
    this.crc = 0xffffffff;
  }

  _transform(chunk, _encoding, callback) {
    this.crc = crc32Update(this.crc, chunk);
    callback(null, chunk);
  }

  _flush(callback) {
    const actual = (this.crc ^ 0xffffffff) >>> 0;
    if (this.expected !== 0 && actual !== this.expected) {
      callback(new Error(`Corrupt archive entry "${this.name}" (CRC mismatch)`));
      return;
    }
    callback();
  }
}

async function readAt(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('Unexpected end of archive');
  return buffer;
}

// Parses a ZIP64 extended-information extra field, substituting only the values
// the classic fields flagged as overflowed (their order is fixed by the spec).
function applyZip64Extra(extra, entry) {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const id = extra.readUInt16LE(pos);
    const size = extra.readUInt16LE(pos + 2);
    if (id === ZIP64_EXTRA_ID) {
      let field = pos + 4;
      const end = Math.min(field + size, extra.length);
      if (entry.uncompressedSize === U32_MAX && field + 8 <= end) {
        entry.uncompressedSize = Number(extra.readBigUInt64LE(field));
        field += 8;
      }
      if (entry.compressedSize === U32_MAX && field + 8 <= end) {
        entry.compressedSize = Number(extra.readBigUInt64LE(field));
        field += 8;
      }
      if (entry.localHeaderOffset === U32_MAX && field + 8 <= end) {
        entry.localHeaderOffset = Number(extra.readBigUInt64LE(field));
      }
      return;
    }
    pos += 4 + size;
  }
}

// Opens a ZIP on disk and reads its central directory. Entry contents are only
// touched when readEntry() is called, so an archive of any size costs a few KB
// of RAM here.
export async function openZipFile(path) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error('Not a valid ZIP archive (too short)');

    // The EOCD is the last 22 bytes unless a comment follows it; scan back over
    // the maximum comment length (64 KiB) for its signature.
    const tailLength = Math.min(size, 22 + U16_MAX);
    const tail = await readAt(handle, tailLength, size - tailLength);
    let eocdOffset = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) throw new Error('Not a valid ZIP archive (no End Of Central Directory record)');

    let totalEntries = tail.readUInt16LE(eocdOffset + 10);
    let centralDirSize = tail.readUInt32LE(eocdOffset + 12);
    let centralDirOffset = tail.readUInt32LE(eocdOffset + 16);

    // ZIP64: the locator sits immediately before the classic EOCD.
    if (totalEntries === U16_MAX || centralDirOffset === U32_MAX || centralDirSize === U32_MAX) {
      const locatorOffset = eocdOffset - 20;
      if (locatorOffset >= 0 && tail.readUInt32LE(locatorOffset) === ZIP64_LOCATOR_SIG) {
        const zip64EocdOffset = Number(tail.readBigUInt64LE(locatorOffset + 8));
        const zip64Eocd = await readAt(handle, 56, zip64EocdOffset);
        if (zip64Eocd.readUInt32LE(0) !== ZIP64_EOCD_SIG) {
          throw new Error('Corrupt ZIP64 End Of Central Directory record');
        }
        totalEntries = Number(zip64Eocd.readBigUInt64LE(32));
        centralDirSize = Number(zip64Eocd.readBigUInt64LE(40));
        centralDirOffset = Number(zip64Eocd.readBigUInt64LE(48));
      }
    }

    const centralDir = await readAt(handle, centralDirSize, centralDirOffset);
    const entries = [];
    let pos = 0;
    for (let i = 0; i < totalEntries; i++) {
      if (pos + 46 > centralDir.length || centralDir.readUInt32LE(pos) !== CENTRAL_SIG) {
        throw new Error('Corrupt ZIP central directory');
      }
      const method = centralDir.readUInt16LE(pos + 10);
      const nameLength = centralDir.readUInt16LE(pos + 28);
      const extraLength = centralDir.readUInt16LE(pos + 30);
      const commentLength = centralDir.readUInt16LE(pos + 32);
      const entry = {
        name: centralDir.toString('utf8', pos + 46, pos + 46 + nameLength),
        method,
        crc: centralDir.readUInt32LE(pos + 16),
        compressedSize: centralDir.readUInt32LE(pos + 20),
        uncompressedSize: centralDir.readUInt32LE(pos + 24),
        localHeaderOffset: centralDir.readUInt32LE(pos + 42),
      };
      if (extraLength > 0) {
        applyZip64Extra(centralDir.subarray(pos + 46 + nameLength, pos + 46 + nameLength + extraLength), entry);
      }
      if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
        throw new Error(`Unsupported ZIP compression method ${method} in "${entry.name}"`);
      }
      entries.push(entry);
      pos += 46 + nameLength + extraLength + commentLength;
    }

    // Resolves an entry's payload start, which needs the local header (its
    // name/extra lengths can differ from the central directory's).
    const dataStart = async (entry) => {
      const header = await readAt(handle, 30, entry.localHeaderOffset);
      if (header.readUInt32LE(0) !== LOCAL_SIG) {
        throw new Error(`Corrupt ZIP local file header for "${entry.name}"`);
      }
      return entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    };

    return {
      entries,
      // Returns a Readable of the entry's decompressed bytes.
      async readEntry(entry) {
        const start = await dataStart(entry);
        const raw = createReadStream(path, {
          start,
          end: start + entry.compressedSize - 1,
          highWaterMark: 256 * 1024,
        });
        const check = new Crc32Check(entry.crc, entry.name);
        if (entry.method === METHOD_STORE) return raw.pipe(check);
        const inflate = zlib.createInflateRaw();
        raw.on('error', (err) => inflate.destroy(err));
        inflate.on('error', (err) => check.destroy(err));
        return raw.pipe(inflate).pipe(check);
      },
      async close() {
        await handle.close();
      },
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}
