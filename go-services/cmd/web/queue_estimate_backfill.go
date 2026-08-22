package main

// One-shot backfill of print-time / filament estimates for queue rows that
// predate the estimator. Twin of server/queueEstimateBackfill.js — see that file
// for the design notes; the behaviour, cadence and log lines match.
//
// Every submission made from now on is estimated inline at submit time. Rows
// already in the table carry estimate_source NULL, which is what this worker
// looks for: it walks them oldest-first, reads each stored model back out of
// Postgres in slices, estimates it, and stamps the row. A row that cannot be
// parsed is stamped SourceNone so it is never picked up again — that, not a
// cursor, is what makes the pass terminate.
//
// Everything here is best-effort: it runs alongside a live server, so it must
// never take the process down, never hold a large buffer for longer than one
// job, and never matter if it does not finish.

import (
	"context"
	"time"

	"printfarm/internal/printestimate"
)

const (
	estimateBackfillBatchSize = 20
	// Pause between jobs so a long backfill cannot monopolise the database pool
	// on a farm with hundreds of stored models.
	estimateBackfillJobDelay   = 250 * time.Millisecond
	estimateBackfillBatchDelay = 2 * time.Second
	// Give the server time to finish booting and serve traffic before starting.
	estimateBackfillStartDelay = 15 * time.Second
	estimateBackfillChunkBytes = 4 * 1024 * 1024
)

// readStoredQueueFile streams one job's stored model back out of the bytea in
// slices rather than selecting the whole column, matching how the download route
// reads it.
func readStoredQueueFile(ctx context.Context, id string, sizeBytes int64) ([]byte, error) {
	out := make([]byte, 0, sizeBytes)
	offset := 0
	for int64(offset) < sizeBytes {
		chunk, err := readQueueJobFileChunk(ctx, id, offset, estimateBackfillChunkBytes)
		if err != nil {
			return nil, err
		}
		if len(chunk) == 0 {
			break
		}
		out = append(out, chunk...)
		offset += len(chunk)
	}
	return out, nil
}

// estimateOneQueueJob fills in a single row. It reports whether a usable
// estimate was produced; either way the row is stamped so it is not retried.
func estimateOneQueueJob(ctx context.Context, job queueEstimateCandidate, cfg printestimate.Config) bool {
	pieces := job.fileCount
	if pieces < 1 {
		pieces = 1
	}

	var result *printestimate.Result
	buf, err := readStoredQueueFile(ctx, job.id, job.fileSize)
	if err != nil {
		// Fall through to the SourceNone stamp — a file we cannot read is a file
		// we cannot estimate, and retrying it on every boot would be pure waste.
		logWarn("queue estimate backfill: failed to read stored model",
			map[string]any{"err": err.Error()})
	} else if len(buf) > 0 {
		result = printestimate.FromModel(buf, job.filename, pieces, cfg)
	}

	var minutes *int
	var grams *float64
	source := printestimate.SourceNone
	if result != nil {
		source = result.Source
		m := result.Minutes
		minutes = &m
		if result.HasGrams {
			g := result.Grams
			grams = &g
		}
	}

	if err := updateQueueJobEstimate(ctx, job.id, minutes, grams, source); err != nil {
		logWarn("queue estimate backfill: failed to store estimate",
			map[string]any{"err": err.Error()})
		return false
	}
	return result != nil
}

func runQueueEstimateBackfill(ctx context.Context) {
	cfg := printestimate.ConfigFromEnv()

	// Rows with no stored file, or one too large to parse, can be dismissed in a
	// single statement instead of being paged through one at a time.
	if skipped, err := markQueueJobsUnestimatable(ctx, cfg.MaxBytes); err != nil {
		logWarn("queue estimate backfill failed", map[string]any{"err": err.Error()})
		return
	} else if skipped > 0 {
		logInfo("queue estimate backfill: skipped jobs with no usable file",
			map[string]any{"count": skipped})
	}

	estimated := 0
	failed := 0
	for {
		jobs, err := listQueueJobsNeedingEstimate(ctx, estimateBackfillBatchSize, cfg.MaxBytes)
		if err != nil {
			logWarn("queue estimate backfill failed", map[string]any{"err": err.Error()})
			return
		}
		if len(jobs) == 0 {
			break
		}

		for _, job := range jobs {
			if ctx.Err() != nil {
				return
			}
			if estimateOneQueueJob(ctx, job, cfg) {
				estimated++
			} else {
				failed++
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(estimateBackfillJobDelay):
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(estimateBackfillBatchDelay):
		}
	}

	if estimated > 0 || failed > 0 {
		logInfo("queue estimate backfill complete",
			map[string]any{"estimated": estimated, "unestimatable": failed})
	}
}

// startQueueEstimateBackfill schedules the one-shot pass. Returns immediately;
// the work happens on its own goroutine and stops with the supplied context.
func startQueueEstimateBackfill(ctx context.Context) {
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(estimateBackfillStartDelay):
		}
		runQueueEstimateBackfill(ctx)
	}()
}
