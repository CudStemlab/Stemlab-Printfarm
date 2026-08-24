// Minimal, dependency-free reader for a single named entry out of a ZIP / 3MF,
// plus the Bambu/Orca slice_info.config parsers built on top of it.
//
// This lives in server/ rather than slicer-proxy/ because of the image layout:
// Dockerfile.slicer-proxy does `COPY server ./server`, but Dockerfile.web does
// NOT copy slicer-proxy/. So server/ is the only directory both tiers can share
// — the web server's queue estimator (server/printEstimate.js) and the
// slicer-proxy's upload path (slicer-proxy/parse3mf.js, which re-exports from
// here) therefore read a 3MF through one implementation, not two.
//
// Handles stored (method 0) and deflate (method 8) entries; no zip64 /
// encryption, which is fine for the entries a slicer writes. server/zipStream.js
// has a fuller reader (zip64, CRC checks) but is path-based (fs.open) — this one
// works on an in-memory Buffer, which is what both callers have.

import { inflateRawSync } from 'node:zlib';

export const EOCD_SIG = 0x06054b50; // End Of Central Directory
export const CDIR_SIG = 0x02014b50; // Central directory file header
export const LFH_SIG = 0x04034b50; // Local file header

// Locate a central-directory entry by exact name. Compressed size and the local
// header offset come from the central directory (authoritative even when the
// local header defers sizes to a data descriptor).
function findEntryInZip(buf, wantName) {
  const minEocd = 22;
  if (buf.length < minEocd) return null;
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - (minEocd + 0xffff));
  for (let i = buf.length - minEocd; i >= scanStart; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  let p = cdOffset;
  for (let n = 0; n < cdCount; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDIR_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lfhOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wantName) return { method, compSize, lfhOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function readEntryData(buf, entry) {
  const { method, compSize, lfhOffset } = entry;
  if (lfhOffset + 30 > buf.length || buf.readUInt32LE(lfhOffset) !== LFH_SIG) return null;
  // The local header's own name/extra lengths give the data start — they may
  // differ from the central directory's extra length.
  const nameLen = buf.readUInt16LE(lfhOffset + 26);
  const extraLen = buf.readUInt16LE(lfhOffset + 28);
  const dataStart = lfhOffset + 30 + nameLen + extraLen;
  const comp = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return comp; // stored
  if (method === 8) return inflateRawSync(comp); // deflate
  return null; // unsupported compression method
}

// Return the decompressed bytes of `name` from the zip in `buf`, or null.
export function readZipEntry(buf, name) {
  try {
    const entry = findEntryInZip(buf, name);
    if (!entry) return null;
    return readEntryData(buf, entry);
  } catch {
    return null;
  }
}

// Sum a numeric <metadata key="<key>" value="<n>"/> across every plate in a
// slice_info.config XML string. Returns null when the key never appears with a
// usable positive value.
function sumSliceInfoMetadata(xml, key) {
  const re = new RegExp(`key="${key}"\\s+value="([0-9]*\\.?[0-9]+)"`, 'gi');
  let total = 0;
  let seen = false;
  let match = re.exec(xml);
  while (match !== null) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value) && value > 0) {
      total += value;
      seen = true;
    }
    match = re.exec(xml);
  }
  return seen ? total : null;
}

// Sum the plate-level filament weight (grams) from a Bambu / Orca 3MF's
// Metadata/slice_info.config. Each <plate> carries
// <metadata key="weight" value="<grams>"/>; summing across plates yields the
// whole job's filament weight (mirrors bambuddy archive.py's file-level total).
// Returns grams (> 0, one decimal) or null when there's no usable estimate.
export function extractFilamentGramsFrom3mf(buf) {
  const data = readZipEntry(buf, 'Metadata/slice_info.config');
  if (!data) return null;
  const total = sumSliceInfoMetadata(data.toString('utf8'), 'weight');
  return total === null ? null : Math.round(total * 10) / 10;
}

// The slicer's own numbers for an already-sliced 3MF: filament weight (grams,
// key="weight") and predicted print time (seconds, key="prediction"), both
// summed across plates. Either may be null on its own — a project file can
// carry a weight with no prediction — so the caller decides what is usable.
// Returns null when the buffer carries no slice info at all (i.e. it is a raw
// mesh-only 3MF, which the geometry estimator handles instead).
export function extractSliceInfoFrom3mf(buf) {
  const data = readZipEntry(buf, 'Metadata/slice_info.config');
  if (!data) return null;
  const xml = data.toString('utf8');
  const grams = sumSliceInfoMetadata(xml, 'weight');
  const seconds = sumSliceInfoMetadata(xml, 'prediction');
  if (grams === null && seconds === null) return null;
  return {
    grams: grams === null ? null : Math.round(grams * 10) / 10,
    seconds: seconds === null ? null : Math.round(seconds),
  };
}
