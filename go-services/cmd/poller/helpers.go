package main

import (
	"hash/crc32"
	"math"
	"strconv"
	"strings"
	"time"
)

// crc32sum is the IEEE crc32 of a string, matching Python's zlib.crc32 used for
// shard assignment (zlib.crc32 is the IEEE/zip variant).
func crc32sum(s string) uint32 {
	return crc32.ChecksumIEEE([]byte(s))
}

// Printer state is carried as a map[string]any, mirroring the Python poller's
// dict-based model so JSON shapes for the JSONB columns and Redis telemetry stay
// identical. These helpers are the typed accessors over that map. Numbers are
// uniformly float64 (JSON/DB decode that way) and coerced to int only at the DB
// boundary for INTEGER columns.

// pmap is the printer-state alias used throughout the poller.
type pmap = map[string]any

func mGet(m pmap, key string) any {
	if m == nil {
		return nil
	}
	return m[key]
}

func mStr(m pmap, key string) string {
	if s, ok := mGet(m, key).(string); ok {
		return s
	}
	return ""
}

// asFloat reports a numeric value and whether the input was actually a number
// (mirrors Python's isinstance(x, (int, float)) guards).
func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	}
	return 0, false
}

func isNum(v any) bool {
	_, ok := asFloat(v)
	return ok
}

func mFloat(m pmap, key string) (float64, bool) {
	return asFloat(mGet(m, key))
}

// mFloatDef returns the numeric value at key, or def when absent/non-numeric.
func mFloatDef(m pmap, key string, def float64) float64 {
	if f, ok := mFloat(m, key); ok {
		return f
	}
	return def
}

func mInt(m pmap, key string) int {
	if f, ok := mFloat(m, key); ok {
		return int(round(f))
	}
	return 0
}

// mIndex reads an integer that firmware may send as either a number or a
// decimal string. Bambu quotes most AMS scalars — `ams[].id` and `tray[].id`
// arrive as "0", "1", … — so plain mInt silently yields 0 for every one of
// them and collapses distinct slots onto the same key. Use this for any field
// used as an identifier or array index.
func mIndex(m pmap, key string) (int, bool) {
	raw := mGet(m, key)
	if raw == nil {
		return 0, false
	}
	if f, ok := asFloat(raw); ok {
		return int(round(f)), true
	}
	if s, ok := raw.(string); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
			return n, true
		}
	}
	return 0, false
}

// mIndexDef is mIndex with a fallback for the absent/unparseable case.
func mIndexDef(m pmap, key string, def int) int {
	if n, ok := mIndex(m, key); ok {
		return n
	}
	return def
}

func mMap(m pmap, key string) pmap {
	if sub, ok := mGet(m, key).(pmap); ok {
		return sub
	}
	return nil
}

func mSlice(m pmap, key string) []any {
	if s, ok := mGet(m, key).([]any); ok {
		return s
	}
	return nil
}

func asMap(v any) pmap {
	if m, ok := v.(pmap); ok {
		return m
	}
	return nil
}

func asSlice(v any) []any {
	if s, ok := v.([]any); ok {
		return s
	}
	return nil
}

// round matches Python's round()-to-nearest for display values. (Python uses
// banker's rounding; the half-integer boundary cases are immaterial for the
// temperatures/percentages involved, so round-half-away is used here.)
func round(v float64) float64 {
	return math.Round(v)
}

// round1 rounds to one decimal place, like round(x, 1).
func round1(v float64) float64 {
	return math.Round(v*10) / 10
}

func clampInt(v, lo, hi float64) int {
	if v < lo {
		v = lo
	}
	if v > hi {
		v = hi
	}
	return int(v)
}

const isoLayout = "2006-01-02T15:04:05Z"

func isoTimestamp() string {
	return time.Now().UTC().Format(isoLayout)
}

// parseISOEpoch parses an iso_timestamp() string back to unix seconds.
func parseISOEpoch(s string) (int64, bool) {
	t, err := time.Parse(isoLayout, s)
	if err != nil {
		return 0, false
	}
	return t.Unix(), true
}

// clone makes a shallow copy of a printer map (the Python `{**printer}` idiom).
func clone(m pmap) pmap {
	out := make(pmap, len(m)+8)
	for k, v := range m {
		out[k] = v
	}
	return out
}

// merge applies src's keys onto a shallow copy of base (the `{**base, **src}` idiom).
func merge(base, src pmap) pmap {
	out := clone(base)
	for k, v := range src {
		out[k] = v
	}
	return out
}
