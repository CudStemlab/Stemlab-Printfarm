package main

import (
	"encoding/json"
	"reflect"
	"strconv"
	"testing"
)

// Reports are parsed from JSON rather than hand-built so the tests exercise the
// same shapes onMessage actually sees — notably numbers arriving as float64 and
// nested objects as map[string]any.
func parseReport(t *testing.T, raw string) pmap {
	t.Helper()
	var out pmap
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("bad test fixture JSON: %v", err)
	}
	return out
}

// trayAt walks a merged report down to one tray so assertions stay readable.
func trayAt(t *testing.T, report pmap, unitID, trayID string) pmap {
	t.Helper()
	for _, unitAny := range mSlice(asMap(report["ams"]), "ams") {
		unit := asMap(unitAny)
		if unitKey(unit) != unitID {
			continue
		}
		for _, trayAny := range mSlice(unit, "tray") {
			tray := asMap(trayAny)
			if unitKey(tray) == trayID {
				return tray
			}
		}
	}
	t.Fatalf("tray %s:%s not found in merged report", unitID, trayID)
	return nil
}

const pushallWithTag = `{
  "gcode_state": "RUNNING",
  "ams": {
    "tray_now": "0",
    "ams": [{
      "id": "0",
      "tray_exist_bits": "f",
      "tray": [
        {"id": "0", "state": 11, "tray_type": "PLA", "tray_color": "00AE42FF", "remain": 85,
         "tag_uid": "A1B2C3D4E5F60718", "tray_uuid": "0123456789ABCDEF0123456789ABCDEF"},
        {"id": "1", "state": 11, "tray_type": "PETG", "tray_color": "FFFFFFFF", "remain": 60,
         "tag_uid": "1122334455667788", "tray_uuid": "FEDCBA9876543210FEDCBA9876543210"}
      ]
    }]
  }
}`

// The regression this whole file exists for: a periodic partial update that
// reports the RFID fields as empty must not erase the pushall's reading.
func TestMergeBambuReport_StickyRfidAcrossEmptyPartial(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "0", "tray": [
	    {"id": "0", "state": 11, "tray_type": "PLA", "remain": 84, "tag_uid": "", "tray_uuid": ""}
	  ]}]}
	}`)
	merged := mergeBambuReport(cached, partial)

	tray := trayAt(t, merged, "0", "0")
	if got := mStr(tray, "tag_uid"); got != "A1B2C3D4E5F60718" {
		t.Errorf("tag_uid = %q, want the cached reading to survive the empty partial", got)
	}
	if got := mStr(tray, "tray_uuid"); got != "0123456789ABCDEF0123456789ABCDEF" {
		t.Errorf("tray_uuid = %q, want the cached reading to survive the empty partial", got)
	}
	// Non-sticky fields must still track the partial.
	if got := mInt(tray, "remain"); got != 84 {
		t.Errorf("remain = %d, want 84 (non-sticky fields always take the incoming value)", got)
	}
}

// All-zero sentinels are the other shape firmware uses for "nothing read".
func TestMergeBambuReport_StickyRfidAcrossZeroSentinelPartial(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "0", "tray": [
	    {"id": "0", "state": 11, "tray_type": "PLA",
	     "tag_uid": "0000000000000000",
	     "tray_uuid": "00000000000000000000000000000000"}
	  ]}]}
	}`)
	tray := trayAt(t, mergeBambuReport(cached, partial), "0", "0")

	if got := mStr(tray, "tag_uid"); got != "A1B2C3D4E5F60718" {
		t.Errorf("tag_uid = %q, want the zero sentinel to be ignored", got)
	}
	if got := mStr(tray, "tray_uuid"); got != "0123456789ABCDEF0123456789ABCDEF" {
		t.Errorf("tray_uuid = %q, want the zero sentinel to be ignored", got)
	}
}

// Stickiness must not become stubbornness: a real new reading wins.
func TestMergeBambuReport_GenuineTagOverwrites(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "0", "tray": [
	    {"id": "0", "state": 11, "tray_type": "PLA",
	     "tag_uid": "9999888877776666",
	     "tray_uuid": "AAAABBBBCCCCDDDDAAAABBBBCCCCDDDD"}
	  ]}]}
	}`)
	tray := trayAt(t, mergeBambuReport(cached, partial), "0", "0")

	if got := mStr(tray, "tag_uid"); got != "9999888877776666" {
		t.Errorf("tag_uid = %q, want the new genuine reading to win", got)
	}
	if got := mStr(tray, "tray_uuid"); got != "AAAABBBBCCCCDDDDAAAABBBBCCCCDDDD" {
		t.Errorf("tray_uuid = %q, want the new genuine reading to win", got)
	}
}

// A spool physically leaving the slot must drop the identity, or the tray keeps
// reporting the spool that used to be there.
func TestMergeBambuReport_ClearsOnEmptyState(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	for _, state := range []int{9, 10} {
		partial := parseReport(t, `{
		  "ams": {"ams": [{"id": "0", "tray": [
		    {"id": "0", "state": `+strconv.Itoa(state)+`, "tray_type": "", "tag_uid": "", "tray_uuid": ""}
		  ]}]}
		}`)
		tray := trayAt(t, mergeBambuReport(cached, partial), "0", "0")

		if got := mStr(tray, "tag_uid"); got != zeroTagUID {
			t.Errorf("state %d: tag_uid = %q, want the zero sentinel", state, got)
		}
		if got := mStr(tray, "tray_uuid"); got != zeroTrayUUID {
			t.Errorf("state %d: tray_uuid = %q, want the zero sentinel", state, got)
		}
	}
}

// The second, independent empty signal: the unit's per-slot bitmask.
func TestMergeBambuReport_ClearsOnTrayExistBits(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	// "d" = 1101: slot 1's bit is clear, slots 0/2/3 still occupied. No `state`
	// field at all, so the bitmask is the only signal available.
	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "0", "tray_exist_bits": "d", "tray": [
	    {"id": "0", "tray_type": "PLA", "tag_uid": "", "tray_uuid": ""},
	    {"id": "1", "tray_type": "", "tag_uid": "", "tray_uuid": ""}
	  ]}]}
	}`)
	merged := mergeBambuReport(cached, partial)

	if got := mStr(trayAt(t, merged, "0", "1"), "tag_uid"); got != zeroTagUID {
		t.Errorf("tray 1 tag_uid = %q, want cleared — its exist bit is unset", got)
	}
	if got := mStr(trayAt(t, merged, "0", "0"), "tag_uid"); got != "A1B2C3D4E5F60718" {
		t.Errorf("tray 0 tag_uid = %q, want retained — its exist bit is still set", got)
	}
}

// remain is explicitly in bambuddy's always_update_fields: a legitimate drop to
// zero must not be mistaken for a missing value.
func TestMergeBambuReport_RemainUpdatesToZero(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "0", "tray": [{"id": "0", "state": 11, "remain": 0}]}]}
	}`)
	tray := trayAt(t, mergeBambuReport(cached, partial), "0", "0")

	if got := mInt(tray, "remain"); got != 0 {
		t.Errorf("remain = %d, want 0", got)
	}
	if got := mStr(tray, "tray_type"); got != "PLA" {
		t.Errorf("tray_type = %q, want PLA carried over from cache", got)
	}
}

// Units are matched by id, not slice position — the bug a positional merge
// would introduce is silently rewriting unit 0 with unit 1's contents.
func TestMergeBambuReport_PartialSingleUnitLeavesOthersIntact(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, `{
	  "ams": {"ams": [
	    {"id": "0", "tray": [{"id": "0", "tray_type": "PLA", "tag_uid": "AAAAAAAAAAAAAAAA"}]},
	    {"id": "1", "tray": [{"id": "0", "tray_type": "ABS", "tag_uid": "BBBBBBBBBBBBBBBB"}]}
	  ]}
	}`))

	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "1", "tray": [{"id": "0", "tray_type": "ASA", "tag_uid": ""}]}]}
	}`)
	merged := mergeBambuReport(cached, partial)

	unit0 := trayAt(t, merged, "0", "0")
	if got := mStr(unit0, "tray_type"); got != "PLA" {
		t.Errorf("unit 0 tray_type = %q, want PLA — it was not in the partial", got)
	}
	if got := mStr(unit0, "tag_uid"); got != "AAAAAAAAAAAAAAAA" {
		t.Errorf("unit 0 tag_uid = %q, want untouched", got)
	}
	unit1 := trayAt(t, merged, "1", "0")
	if got := mStr(unit1, "tray_type"); got != "ASA" {
		t.Errorf("unit 1 tray_type = %q, want ASA from the partial", got)
	}
	if got := mStr(unit1, "tag_uid"); got != "BBBBBBBBBBBBBBBB" {
		t.Errorf("unit 1 tag_uid = %q, want sticky retain", got)
	}
}

// An AMS powered on mid-session appears for the first time in a partial.
func TestMergeBambuReport_NewUnitAppended(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, `{
	  "ams": {"ams": [{"id": "0", "tray": [{"id": "0", "tray_type": "PLA"}]}]}
	}`))

	partial := parseReport(t, `{
	  "ams": {"ams": [{"id": "1", "tray": [{"id": "0", "tray_type": "TPU", "tag_uid": "CCCCCCCCCCCCCCCC"}]}]}
	}`)
	merged := mergeBambuReport(cached, partial)

	if got := mStr(trayAt(t, merged, "0", "0"), "tray_type"); got != "PLA" {
		t.Errorf("unit 0 tray_type = %q, want PLA", got)
	}
	if got := mStr(trayAt(t, merged, "1", "0"), "tray_type"); got != "TPU" {
		t.Errorf("unit 1 tray_type = %q, want TPU", got)
	}
}

// The external spool is a bare tray at the report root and needs the same
// stickiness as an AMS tray.
func TestMergeBambuReport_VtTraySticky(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, `{
	  "vt_tray": {"id": "254", "tray_type": "PLA", "remain": 50,
	              "tag_uid": "EEEEFFFF00001111",
	              "tray_uuid": "11112222333344445555666677778888"}
	}`))

	partial := parseReport(t, `{
	  "vt_tray": {"id": "254", "tray_type": "PLA", "remain": 49, "tag_uid": "", "tray_uuid": ""}
	}`)
	vt := asMap(mergeBambuReport(cached, partial)["vt_tray"])

	if got := mStr(vt, "tag_uid"); got != "EEEEFFFF00001111" {
		t.Errorf("vt_tray tag_uid = %q, want sticky retain", got)
	}
	if got := mStr(vt, "tray_uuid"); got != "11112222333344445555666677778888" {
		t.Errorf("vt_tray tray_uuid = %q, want sticky retain", got)
	}
	if got := mInt(vt, "remain"); got != 49 {
		t.Errorf("vt_tray remain = %d, want 49", got)
	}
}

// Top-level scalars must keep merging exactly as the old loop did.
func TestMergeBambuReport_ScalarsPassThrough(t *testing.T) {
	cached := mergeBambuReport(nil, parseReport(t, `{"gcode_state": "RUNNING", "bed_temper": 60}`))
	merged := mergeBambuReport(cached, parseReport(t, `{"gcode_state": "PAUSE"}`))

	if got := mStr(merged, "gcode_state"); got != "PAUSE" {
		t.Errorf("gcode_state = %q, want PAUSE", got)
	}
	if got := mInt(merged, "bed_temper"); got != 60 {
		t.Errorf("bed_temper = %d, want 60 carried over", got)
	}
}

// latestReport hands callers a shallow clone they traverse after the mutex is
// released, so nested maps are shared with the cache. Merging must therefore be
// copy-on-write — an in-place write into a previously-published map is a data
// race that no amount of locking in onMessage would fix.
func TestMergeBambuReport_DoesNotMutatePreviousResult(t *testing.T) {
	first := mergeBambuReport(nil, parseReport(t, pushallWithTag))

	snapshot, err := json.Marshal(first)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}

	mergeBambuReport(first, parseReport(t, `{
	  "gcode_state": "PAUSE",
	  "ams": {"tray_now": "1", "ams": [{"id": "0", "tray_exist_bits": "1", "tray": [
	    {"id": "0", "state": 9, "tray_type": "", "remain": 0, "tag_uid": "", "tray_uuid": ""},
	    {"id": "1", "state": 11, "tray_type": "ABS", "tag_uid": "5555555555555555"}
	  ]}]},
	  "vt_tray": {"id": "254", "tray_type": "TPU"}
	}`))

	after, err := json.Marshal(first)
	if err != nil {
		t.Fatalf("marshal after: %v", err)
	}
	if !reflect.DeepEqual(snapshot, after) {
		t.Fatalf("merge mutated a previously-returned report in place\nbefore: %s\nafter:  %s", snapshot, after)
	}
}

func TestIsGenuineTagValue(t *testing.T) {
	cases := map[string]bool{
		"":                                 false,
		"0000000000000000":                 false,
		"00000000000000000000000000000000": false,
		"0000-0000":                        false,
		"A1B2C3D4E5F60718":                 true,
		"0123456789ABCDEF0123456789ABCDEF": true,
		"0000000000000001":                 true,
	}
	for input, want := range cases {
		if got := isGenuineTagValue(input); got != want {
			t.Errorf("isGenuineTagValue(%q) = %v, want %v", input, got, want)
		}
	}
}

// Bambu quotes AMS scalars, so ids arrive as "0"/"1". mInt returns 0 for those,
// which is how rawBambuTrays came to key every tray as "0:0".
func TestMIndex_HandlesQuotedFirmwareScalars(t *testing.T) {
	tray := parseReport(t, `{"id": "3", "state": "11", "numeric": 2, "blank": "", "junk": "x"}`)

	if got, ok := mIndex(tray, "id"); got != 3 || !ok {
		t.Errorf("mIndex(id) = (%d, %v), want (3, true)", got, ok)
	}
	if got, ok := mIndex(tray, "state"); got != 11 || !ok {
		t.Errorf("mIndex(state) = (%d, %v), want (11, true)", got, ok)
	}
	if got, ok := mIndex(tray, "numeric"); got != 2 || !ok {
		t.Errorf("mIndex(numeric) = (%d, %v), want (2, true)", got, ok)
	}
	for _, key := range []string{"blank", "junk", "absent"} {
		if got, ok := mIndex(tray, key); ok {
			t.Errorf("mIndex(%s) = (%d, true), want not-ok", key, got)
		}
	}
	if got := mIndexDef(tray, "absent", 7); got != 7 {
		t.Errorf("mIndexDef(absent, 7) = %d, want 7", got)
	}
	// The old behaviour, kept as documentation of what this replaced.
	if got := mInt(tray, "id"); got != 0 {
		t.Errorf("mInt(id) = %d, want 0 — mInt cannot read quoted ids", got)
	}
}

func TestBambuLoadedSlotID(t *testing.T) {
	cases := []struct {
		name   string
		report string
		want   string
	}{
		{"ams unit 0 tray 0", `{"ams": {"tray_now": "0"}}`, "ams0-0"},
		{"ams unit 0 tray 2", `{"ams": {"tray_now": "2"}}`, "ams0-2"},
		{"ams unit 1 tray 1", `{"ams": {"tray_now": "5"}}`, "ams1-1"},
		{"numeric tray_now", `{"ams": {"tray_now": 3}}`, "ams0-3"},
		// 254 is the external spool, and only counts when one is reported.
		{"external loaded", `{"ams": {"tray_now": "254"}, "vt_tray": {"id": "254"}}`, "external"},
		{"external absent", `{"ams": {"tray_now": "254"}}`, ""},
		// 255 is the case bambuActiveSpoolID cannot distinguish: nothing loaded.
		{"nothing loaded", `{"ams": {"tray_now": "255"}, "vt_tray": {"id": "254"}}`, ""},
		{"no tray_now", `{"ams": {}}`, ""},
		{"no ams", `{}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := bambuLoadedSlotID(parseReport(t, tc.report)); got != tc.want {
				t.Errorf("bambuLoadedSlotID = %q, want %q", got, tc.want)
			}
		})
	}
}

// The active flag must land on exactly one slot, and on none when the extruder
// is empty — that "none" case is what enables the re-read button.
func TestBuildBambuSpools_MarksActiveSlot(t *testing.T) {
	report := parseReport(t, `{
	  "ams": {"tray_now": "1", "ams": [{"id": "0", "tray": [
	    {"id": "0", "tray_type": "PLA", "tray_color": "00AE42FF", "remain": 80, "tray_weight": 1000},
	    {"id": "1", "tray_type": "PETG", "tray_color": "FFFFFFFF", "remain": 50, "tray_weight": 1000}
	  ]}]}
	}`)

	active := map[string]bool{}
	for _, entryAny := range asSlice(buildBambuSpools(report)) {
		entry := asMap(entryAny)
		active[mStr(entry, "id")], _ = entry["active"].(bool)
	}
	want := map[string]bool{"ams0-0": false, "ams0-1": true}
	if !reflect.DeepEqual(active, want) {
		t.Fatalf("active flags = %v, want %v", active, want)
	}

	// tray_now 255 — nothing fed to the extruder, so no slot is active.
	idle := parseReport(t, `{
	  "ams": {"tray_now": "255", "ams": [{"id": "0", "tray": [
	    {"id": "0", "tray_type": "PLA", "tray_color": "00AE42FF", "remain": 80, "tray_weight": 1000}
	  ]}]}
	}`)
	for _, entryAny := range asSlice(buildBambuSpools(idle)) {
		if on, _ := asMap(entryAny)["active"].(bool); on {
			t.Errorf("slot %q marked active with tray_now=255", mStr(asMap(entryAny), "id"))
		}
	}
}

func TestTrayExistBits(t *testing.T) {
	cases := []struct {
		name  string
		unit  string
		want  int
		wantK bool
	}{
		{"hex string", `{"tray_exist_bits": "f"}`, 15, true},
		{"hex string uppercase", `{"tray_exist_bits": "D"}`, 13, true},
		{"numeric", `{"tray_exist_bits": 3}`, 3, true},
		{"absent", `{}`, 0, false},
		{"null", `{"tray_exist_bits": null}`, 0, false},
		{"non-hex", `{"tray_exist_bits": "zz"}`, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var unit pmap
			if err := json.Unmarshal([]byte(tc.unit), &unit); err != nil {
				t.Fatalf("bad fixture: %v", err)
			}
			got, ok := trayExistBits(unit)
			if got != tc.want || ok != tc.wantK {
				t.Errorf("trayExistBits = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.wantK)
			}
		})
	}
}
