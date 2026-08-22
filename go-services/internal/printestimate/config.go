// Package printestimate estimates a queue submission's print time and filament
// usage from the uploaded model file.
//
// It is the Go twin of server/printEstimate.js (+ server/threemf.js) and must
// stay behaviourally identical: the two web tiers write the same
// queue_jobs.estimated_time / estimated_filament_grams / estimate_source values,
// so a farm that switches tiers must not see its estimates shift.
//
// Sources, best first:
//
//	SourceSlicer   — an already-sliced Orca / Bambu Studio project file, whose
//	                 Metadata/slice_info.config carries the slicer's own weight
//	                 (grams) and prediction (seconds). Exact.
//	SourceGeometry — a raw mesh (STL / OBJ / mesh-only 3MF): solid volume and
//	                 surface area from the triangles, through the shell/infill/
//	                 flow model in estimate.go. Approximate, ±30-50%.
//	SourceBBox     — the mesh is open or non-manifold, so its signed volume is
//	                 meaningless; falls back to a fraction of the bounding box.
//
// Stdlib only (archive/zip, encoding/xml, encoding/binary) — no new deps.
package printestimate

import (
	"os"
	"strconv"
)

// Source names where an estimate came from; the values are written verbatim to
// queue_jobs.estimate_source and read by the frontend.
const (
	SourceSlicer   = "slicer"
	SourceGeometry = "geometry"
	SourceBBox     = "bbox"
	// SourceNone marks a file that could not be estimated, so a backfill pass
	// does not retry it forever.
	SourceNone = "none"
)

// Config holds the material and machine assumptions. Defaults describe a typical
// classroom PLA print at 0.2 mm on a bed-slinger; every field is env-tunable
// because the right values depend on the farm's printers, and TimeFactor lets an
// operator correct a systematic bias without a code change.
type Config struct {
	ShellMm        float64 // combined perimeter + skin thickness over the surface
	Infill         float64 // fraction of the remaining interior actually extruded
	DensityGCm3    float64 // PLA
	LayerMm        float64
	FlowMm3S       float64 // effective volumetric extrusion rate over a whole print
	LayerOverheadS float64 // travel / z-hop / retraction per layer
	FixedOverheadS float64 // heat-up, bed level, purge line
	TimeFactor     float64 // operator calibration knob
	MaxTriangles   int
	MaxBytes       int
}

// DefaultConfig mirrors DEFAULT_CONFIG in server/printEstimate.js exactly.
func DefaultConfig() Config {
	return Config{
		ShellMm:        1.0,
		Infill:         0.15,
		DensityGCm3:    1.24,
		LayerMm:        0.2,
		FlowMm3S:       6,
		LayerOverheadS: 2.5,
		FixedOverheadS: 180,
		TimeFactor:     1.0,
		MaxTriangles:   3_000_000,
		MaxBytes:       64 * 1024 * 1024,
	}
}

func envFloat(name string, fallback, min, max float64) float64 {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value < min || value > max {
		return fallback
	}
	return value
}

// ConfigFromEnv reads the PRINT_ESTIMATE_* variables, falling back to
// DefaultConfig for anything unset or out of range (same bounds as the Node
// side, so a bad value degrades identically in both tiers).
func ConfigFromEnv() Config {
	d := DefaultConfig()
	return Config{
		ShellMm:        envFloat("PRINT_ESTIMATE_SHELL_MM", d.ShellMm, 0.01, 20),
		Infill:         envFloat("PRINT_ESTIMATE_INFILL", d.Infill, 0, 1),
		DensityGCm3:    envFloat("PRINT_ESTIMATE_DENSITY", d.DensityGCm3, 0.1, 10),
		LayerMm:        envFloat("PRINT_ESTIMATE_LAYER_MM", d.LayerMm, 0.01, 2),
		FlowMm3S:       envFloat("PRINT_ESTIMATE_FLOW_MM3S", d.FlowMm3S, 0.1, 500),
		LayerOverheadS: envFloat("PRINT_ESTIMATE_LAYER_OVERHEAD_S", d.LayerOverheadS, 0, 60),
		FixedOverheadS: envFloat("PRINT_ESTIMATE_FIXED_OVERHEAD_S", d.FixedOverheadS, 0, 7200),
		TimeFactor:     envFloat("PRINT_ESTIMATE_TIME_FACTOR", d.TimeFactor, 0.1, 10),
		MaxTriangles:   int(envFloat("PRINT_ESTIMATE_MAX_TRIANGLES", float64(d.MaxTriangles), 1000, 100_000_000)),
		MaxBytes:       int(envFloat("PRINT_ESTIMATE_MAX_BYTES", float64(d.MaxBytes), 1024, 1024*1024*1024)),
	}
}
