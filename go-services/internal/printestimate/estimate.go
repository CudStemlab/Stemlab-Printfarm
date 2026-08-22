package printestimate

import (
	"math"
	"path/filepath"
	"strings"
)

// Result is what the caller stores: queue_jobs.estimated_filament_grams,
// estimated_time (minutes) and estimate_source.
type Result struct {
	Grams    float64
	HasGrams bool
	Minutes  int
	Source   string
}

// geometryToEstimate turns geometry into grams and minutes.
//
//	shellV    = surface area × shell thickness, i.e. perimeters and skins
//	            treated as one band wrapping the whole surface
//	materialV = shellV + the remaining interior at the infill fraction
//	time      = fixed overhead + extrusion at the effective flow rate
//	            + a per-layer travel cost, scaled by the calibration factor
//
// This is a heuristic, not a slicer: it ignores supports, brims, variable layer
// height, and the fact that thin walls are all shell. Hence the ± in the UI.
func geometryToEstimate(g *geometry, pieces int, cfg Config) (float64, int) {
	modelV := g.VolumeMm3
	shellV := math.Min(g.AreaMm2*cfg.ShellMm, modelV)
	materialV := shellV + (modelV-shellV)*cfg.Infill
	materialV = math.Min(math.Max(materialV, modelV*cfg.Infill), modelV)

	gramsEach := (materialV / 1000) * cfg.DensityGCm3
	layers := math.Max(1, math.Ceil(g.Height/cfg.LayerMm))
	secondsEach := cfg.FixedOverheadS + materialV/cfg.FlowMm3S + layers*cfg.LayerOverheadS

	grams := math.Round(gramsEach*float64(pieces)*10) / 10
	minutes := int(math.Round(secondsEach * cfg.TimeFactor * float64(pieces) / 60))
	if minutes < 1 {
		minutes = 1
	}
	return grams, minutes
}

// FromModel estimates a queue submission's print time and filament usage.
//
// filename is used only to pick a parser. pieces multiplies the result (each
// piece is a separate print, so the fixed overhead is paid per piece). Returns
// nil when nothing usable could be read — unsupported, corrupt or oversized —
// which the caller records as SourceNone so it is not retried forever.
//
// Must stay behaviourally identical to estimateFromModel in
// server/printEstimate.js.
func FromModel(buf []byte, filename string, pieces int, cfg Config) *Result {
	if len(buf) == 0 || len(buf) > cfg.MaxBytes {
		return nil
	}
	if pieces < 1 {
		pieces = 1
	}
	ext := strings.ToLower(filepath.Ext(filename))

	// A sliced project file wins outright — those are the slicer's own numbers.
	if ext == ".3mf" {
		if info := ExtractSliceInfo(buf); info != nil {
			result := &Result{Source: SourceSlicer}
			if info.HasGrams {
				result.Grams = math.Round(info.Grams*float64(pieces)*10) / 10
				result.HasGrams = true
			}
			if info.HasSeconds {
				result.Minutes = int(math.Round(info.Seconds * float64(pieces) / 60))
				if result.Minutes < 1 {
					result.Minutes = 1
				}
			} else {
				// No prediction in the file: keep the old quantity-derived
				// placeholder for time rather than inventing one.
				result.Minutes = pieces * 60
				if result.Minutes < 30 {
					result.Minutes = 30
				}
			}
			return result
		}
	}

	var g *geometry
	switch ext {
	case ".stl":
		g = parseSTL(buf, cfg)
	case ".obj":
		g = parseOBJ(buf, cfg)
	case ".3mf":
		g = parse3mfMesh(buf, cfg)
	}
	if g == nil {
		return nil
	}

	// A signed volume outside (0, bbox] means the surface is not closed — an open
	// or self-intersecting mesh. The number is then meaningless, so fall back to
	// a fraction of the bounding box and say so via the source.
	source := SourceGeometry
	// Scaled by the instance count: the box is the footprint of ONE copy, so a
	// plate holding three of the same object legitimately carries three times the
	// volume of that box.
	bboxV := g.Width * g.Depth * g.Height * float64(g.Instances)
	if !(g.VolumeMm3 > 0) || (bboxV > 0 && g.VolumeMm3 > bboxV*1.001) {
		if !(bboxV > 0) {
			return nil
		}
		// Assume the part fills 30% of its bounding box, and use the box's own
		// surface area for the shell term — the mesh's area is as untrustworthy
		// as its volume once the surface is known to be open.
		bboxArea := 2 * (g.Width*g.Depth + g.Width*g.Height + g.Depth*g.Height) * float64(g.Instances)
		adjusted := *g
		adjusted.VolumeMm3 = bboxV * 0.3
		adjusted.AreaMm2 = bboxArea
		g = &adjusted
		source = SourceBBox
	}

	grams, minutes := geometryToEstimate(g, pieces, cfg)
	if math.IsNaN(grams) || math.IsInf(grams, 0) || grams <= 0 {
		return nil
	}
	return &Result{Grams: grams, HasGrams: true, Minutes: minutes, Source: source}
}
