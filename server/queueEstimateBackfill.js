// One-shot backfill of print-time / filament estimates for queue rows that
// predate the estimator.
//
// Every submission made from now on is estimated inline at submit time
// (server/app.js). Rows already in the table carry estimate_source NULL, which
// is what this worker looks for: it walks them oldest-first, reads each stored
// model back out of Postgres in slices, estimates it, and stamps the row. A row
// that cannot be parsed is stamped 'none' so it is never picked up again — that,
// not a cursor, is what makes the pass terminate.
//
// Everything here is best-effort. It runs in the background of a live web
// process, so it must never throw into the event loop, never hold a large
// buffer for longer than one job, and never matter if it does not finish: the
// only consequence of giving up is a queue row showing no estimate.

import {
  listQueueJobsNeedingEstimate,
  markQueueJobsUnestimatable,
  readQueueJobFileChunk,
  updateQueueJobEstimate,
} from './postgres.js';
import { estimateConfigFromEnv, estimateFromModel } from './printEstimate.js';
import { logger } from './logger.js';

const BATCH_SIZE = 20;
// Pause between jobs so a long backfill cannot monopolise the database pool or
// the event loop on a farm with hundreds of stored models.
const JOB_DELAY_MS = 250;
const BATCH_DELAY_MS = 2000;
// Give the server time to finish booting and serve traffic before starting.
const START_DELAY_MS = 15_000;
const CHUNK_BYTES = 4 * 1024 * 1024;

let started = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

// Stream one job's stored model back out of the bytea in slices rather than
// selecting the whole column, matching how the download route reads it.
async function readStoredFile(id, sizeBytes) {
  const chunks = [];
  let offset = 0;
  while (offset < sizeBytes) {
    const chunk = await readQueueJobFileChunk(id, offset, CHUNK_BYTES);
    if (chunk.length === 0) break;
    chunks.push(chunk);
    offset += chunk.length;
  }
  return Buffer.concat(chunks);
}

async function estimateOneJob(job, config) {
  const pieces = Math.max(1, Number(job.file_count) || 1);
  const sizeBytes = Number(job.file_size_bytes) || 0;

  let estimate = null;
  try {
    const buffer = await readStoredFile(job.id, sizeBytes);
    if (buffer.length > 0) {
      estimate = await estimateFromModel(buffer, job.filename, { pieces, config });
    }
  } catch (error) {
    // Fall through to the 'none' stamp — a file we cannot read is a file we
    // cannot estimate, and retrying it on every boot would be pure waste.
    logger.warn('queue estimate backfill: failed to read stored model', error);
  }

  await updateQueueJobEstimate(job.id, {
    estimatedTime: estimate ? estimate.minutes : null,
    filamentGrams: estimate ? estimate.grams : null,
    source: estimate ? estimate.source : 'none',
  });
  return Boolean(estimate);
}

async function runBackfill() {
  const config = estimateConfigFromEnv();

  // Rows with no stored file, or one too large to parse, can be dismissed in a
  // single statement instead of being paged through one at a time.
  const skipped = await markQueueJobsUnestimatable(config.maxBytes);
  if (skipped > 0) {
    logger.info('queue estimate backfill: skipped jobs with no usable file', { count: skipped });
  }

  let estimated = 0;
  let failed = 0;
  for (;;) {
    const jobs = await listQueueJobsNeedingEstimate(BATCH_SIZE, config.maxBytes);
    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (await estimateOneJob(job, config)) {
        estimated += 1;
      } else {
        failed += 1;
      }
      await sleep(JOB_DELAY_MS);
    }
    await sleep(BATCH_DELAY_MS);
  }

  if (estimated > 0 || failed > 0) {
    logger.info('queue estimate backfill complete', { estimated, unestimatable: failed });
  }
}

/**
 * Schedule the one-shot backfill. Safe to call more than once — only the first
 * call does anything. Returns immediately; the work happens in the background
 * and any failure is logged rather than propagated.
 */
export function scheduleQueueEstimateBackfill() {
  if (started) return;
  started = true;

  const timer = setTimeout(() => {
    runBackfill().catch((error) => {
      logger.warn('queue estimate backfill failed', error);
    });
  }, START_DELAY_MS);
  // Do not hold the process open just for the backfill.
  timer.unref?.();
}
