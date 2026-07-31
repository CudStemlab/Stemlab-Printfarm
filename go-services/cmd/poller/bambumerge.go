package main

import "strconv"

// Bambu MQTT report cache merge.
//
// The printer's initial `pushall` carries the complete `print` tree; everything
// after it is a *partial* update carrying only what changed. A blind top-level
// merge (`cache[k] = v`) is correct for scalars but wrong for the `ams` subtree,
// because it replaces the whole tree — including trays the partial never
// mentioned — with whatever subset the printer happened to send.
//
// That matters specifically for RFID identity. Bambu firmware routinely emits
// `tag_uid`/`tray_uuid` as empty or all-zero in periodic AMS updates, so a
// wholesale replace destroys the identity read during pushall until the next
// one. Bambuddy hit this and guards it the same way — those two fields are
// deliberately excluded from its `always_update_fields` list and are only
// cleared on genuine spool removal (bambuddy
// backend/app/services/bambu_mqtt.py:1745-1753). Everything downstream of
// printers.spools (filament_matcher.go's auto-catalog, assignments.go's
// fingerprints, filament_consumption.go's tray resolution) is only as reliable
// as this cache, so the stickiness lives here rather than in each consumer.
//
// CONCURRENCY: latestReport returns a *shallow* clone and callers traverse it
// after the mutex is released, so nested maps are shared with the cache. That
// is race-free today only because every nested map is freshly unmarshalled and
// never mutated after publish. These functions preserve that invariant by
// copy-on-write — they build new maps at every level they touch and never
// write into a map already reachable from bambuClient.print.

// stickyTrayFields are carried over from the cached tray when the incoming
// partial reports them empty/zero. Every other field (remain, k, cali_idx,
// tray_type, tray_sub_brands, tray_info_idx, tray_color, tray_id_name, …)
// always takes the incoming value, matching bambuddy's always_update_fields.
var stickyTrayFields = []string{"tag_uid", "tray_uuid"}

// mergeBambuReport applies an incoming `print` payload onto the cached one,
// returning a new map. Scalars merge as before; the AMS subtree and the
// external spool tray get field-level treatment so RFID identity survives.
func mergeBambuReport(cached, incoming pmap) pmap {
	out := clone(cached)
	for k, v := range incoming {
		switch k {
		case "ams":
			out[k] = mergeAmsPayload(asMap(mGet(cached, "ams")), asMap(v))
		case "vt_tray":
			// The external spool is a bare tray object hanging off the report
			// root rather than a member of an AMS unit, but it carries the same
			// RFID fields and needs the same stickiness.
			out[k] = mergeTray(asMap(mGet(cached, "vt_tray")), asMap(v), false)
		default:
			out[k] = v
		}
	}
	return out
}

// mergeAmsPayload merges the `ams` object. Units are matched by their `id`
// field rather than slice position: a partial report may carry a single unit,
// and position would then silently rewrite unit 0 with unit 1's contents.
// Units the incoming payload omits are carried over untouched.
func mergeAmsPayload(cached, incoming pmap) any {
	if incoming == nil {
		if cached == nil {
			return nil
		}
		return cached
	}
	if cached == nil {
		return incoming
	}

	out := clone(cached)
	for k, v := range incoming {
		if k != "ams" {
			out[k] = v
			continue
		}
		out[k] = mergeAmsUnits(mSlice(cached, "ams"), asSlice(v))
	}
	return out
}

// mergeAmsUnits merges the `ams.ams` unit array by unit id, preserving the
// cached ordering and appending units seen for the first time.
func mergeAmsUnits(cached, incoming []any) []any {
	if incoming == nil {
		return cached
	}

	// Index the incoming units by id so cached units can be matched in place.
	incomingByID := map[string]pmap{}
	var incomingOrder []string
	for _, unitAny := range incoming {
		unit := asMap(unitAny)
		if unit == nil {
			continue
		}
		id := unitKey(unit)
		if _, seen := incomingByID[id]; !seen {
			incomingOrder = append(incomingOrder, id)
		}
		incomingByID[id] = unit
	}

	out := make([]any, 0, len(cached)+len(incoming))
	merged := map[string]bool{}
	for _, unitAny := range cached {
		unit := asMap(unitAny)
		if unit == nil {
			out = append(out, unitAny)
			continue
		}
		id := unitKey(unit)
		match, ok := incomingByID[id]
		if !ok {
			// Not mentioned in this partial — keep the cached unit as-is.
			out = append(out, unitAny)
			continue
		}
		merged[id] = true
		out = append(out, mergeAmsUnit(unit, match))
	}
	// Units appearing for the first time (e.g. an AMS powered on mid-session).
	for _, id := range incomingOrder {
		if !merged[id] {
			out = append(out, incomingByID[id])
		}
	}
	return out
}

// mergeAmsUnit merges one AMS unit's scalars and its tray array.
func mergeAmsUnit(cached, incoming pmap) pmap {
	out := clone(cached)
	for k, v := range incoming {
		if k != "tray" {
			out[k] = v
			continue
		}
		// tray_exist_bits is a per-unit bitmask of which slots hold a spool.
		// Prefer the incoming value — it describes the trays in this very
		// payload — and fall back to the cached one when absent.
		existBits, hasExistBits := trayExistBits(incoming)
		if !hasExistBits {
			existBits, hasExistBits = trayExistBits(cached)
		}
		out[k] = mergeTrays(mSlice(cached, "tray"), asSlice(v), existBits, hasExistBits)
	}
	return out
}

// mergeTrays merges a unit's tray array by tray id, same matching rules as
// mergeAmsUnits.
func mergeTrays(cached, incoming []any, existBits int, hasExistBits bool) []any {
	if incoming == nil {
		return cached
	}

	incomingByID := map[string]pmap{}
	var incomingOrder []string
	for _, trayAny := range incoming {
		tray := asMap(trayAny)
		if tray == nil {
			continue
		}
		id := unitKey(tray)
		if _, seen := incomingByID[id]; !seen {
			incomingOrder = append(incomingOrder, id)
		}
		incomingByID[id] = tray
	}

	out := make([]any, 0, len(cached)+len(incoming))
	merged := map[string]bool{}
	for _, trayAny := range cached {
		tray := asMap(trayAny)
		if tray == nil {
			out = append(out, trayAny)
			continue
		}
		id := unitKey(tray)
		match, ok := incomingByID[id]
		if !ok {
			out = append(out, trayAny)
			continue
		}
		merged[id] = true
		out = append(out, mergeTray(tray, match, trayCleared(match, existBits, hasExistBits)))
	}
	for _, id := range incomingOrder {
		if !merged[id] {
			tray := incomingByID[id]
			out = append(out, mergeTray(nil, tray, trayCleared(tray, existBits, hasExistBits)))
		}
	}
	return out
}

// mergeTray applies an incoming tray onto the cached one. Every field takes the
// incoming value except tag_uid/tray_uuid, which are sticky: an incoming value
// replaces the cached one only when it is a genuine (non-empty, non-zero)
// reading. When cleared is true the spool has physically left the slot, so both
// are forced to their zero sentinels rather than left pointing at the spool
// that used to be there (bambuddy bambu_mqtt.py:1726-1737).
func mergeTray(cached, incoming pmap, cleared bool) pmap {
	if incoming == nil {
		return cached
	}
	out := clone(cached)
	for k, v := range incoming {
		out[k] = v
	}

	if cleared {
		out["tag_uid"] = zeroTagUID
		out["tray_uuid"] = zeroTrayUUID
		return out
	}

	for _, field := range stickyTrayFields {
		if isGenuineTagValue(mStr(out, field)) {
			continue
		}
		if prev := mStr(cached, field); isGenuineTagValue(prev) {
			out[field] = prev
		}
	}
	return out
}

// isGenuineTagValue reports whether an RFID field holds an actual reading as
// opposed to the empty/all-zero placeholder firmware sends when it has nothing.
// Length-agnostic so it covers both tag_uid (16 hex) and tray_uuid (32 hex);
// normalizeHex is shared with filament_matcher.go so this agrees with the
// predicate the auto-catalog pipeline downstream uses.
func isGenuineTagValue(value string) bool {
	hex := normalizeHex(value)
	if hex == "" {
		return false
	}
	for _, ch := range hex {
		if ch != '0' {
			return true
		}
	}
	return false
}

// trayCleared reports whether a tray is empty — the only condition under which
// sticky RFID fields are dropped. Two independent firmware signals:
//   - the tray's own `state` (9/10 are Bambu's explicit empty codes), read via
//     bambuTrayLoaded so the AMS-firmware quirks documented there are honored
//     in one place rather than re-encoded here;
//   - the unit's `tray_exist_bits` bitmask, one bit per slot.
//
// Only the signals actually present in the payload are consulted: a partial
// that omits both leaves the tray's identity alone.
func trayCleared(tray pmap, existBits int, hasExistBits bool) bool {
	if state, hasState := mIndex(tray, "state"); hasState {
		if !bambuTrayLoaded(state, mStr(tray, "tray_type")) {
			return true
		}
	}
	if hasExistBits {
		if id, ok := mIndex(tray, "id"); ok && id >= 0 && id < 32 {
			if existBits&(1<<uint(id)) == 0 {
				return true
			}
		}
	}
	return false
}

// trayExistBits reads a unit's tray_exist_bits, which firmware sends as a hex
// string ("f") on some models and a number on others.
func trayExistBits(unit pmap) (int, bool) {
	raw, ok := unit["tray_exist_bits"]
	if !ok || raw == nil {
		return 0, false
	}
	if f, isNum := asFloat(raw); isNum {
		return int(f), true
	}
	s, isStr := raw.(string)
	if !isStr || s == "" {
		return 0, false
	}
	bits := 0
	for _, ch := range s {
		var digit int
		switch {
		case ch >= '0' && ch <= '9':
			digit = int(ch - '0')
		case ch >= 'a' && ch <= 'f':
			digit = int(ch-'a') + 10
		case ch >= 'A' && ch <= 'F':
			digit = int(ch-'A') + 10
		default:
			return 0, false
		}
		bits = bits*16 + digit
	}
	return bits, true
}

// unitKey identifies an AMS unit or tray by its `id`, which firmware sends as
// either a number or a string depending on model. Falls back to the raw
// formatting so an unexpected shape still matches itself across reports.
func unitKey(m pmap) string {
	if id, ok := mIndex(m, "id"); ok {
		return strconv.Itoa(id)
	}
	// Not a decimal id at all — fall back to the raw string so an unexpected
	// shape at least matches itself consistently across reports.
	if s, isStr := mGet(m, "id").(string); isStr {
		return s
	}
	return ""
}
