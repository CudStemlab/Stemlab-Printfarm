package printestimate

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"strings"
	"testing"
)

// The 12 triangles of an axis-aligned cube [0,s]³, wound outward. Volume s³,
// surface area 6s². Same fixture as server/printEstimate.test.mjs, so the two
// tiers are checked against the same numbers.
func cubeTriangles(s float64) [][3][3]float64 {
	v := [8][3]float64{
		{0, 0, 0}, {s, 0, 0}, {s, s, 0}, {0, s, 0},
		{0, 0, s}, {s, 0, s}, {s, s, s}, {0, s, s},
	}
	faces := [12][3]int{
		{0, 2, 1}, {0, 3, 2}, // bottom
		{4, 5, 6}, {4, 6, 7}, // top
		{0, 1, 5}, {0, 5, 4}, // front
		{1, 2, 6}, {1, 6, 5}, // right
		{2, 3, 7}, {2, 7, 6}, // back
		{3, 0, 4}, {3, 4, 7}, // left
	}
	out := make([][3][3]float64, 0, len(faces))
	for _, f := range faces {
		out = append(out, [3][3]float64{v[f[0]], v[f[1]], v[f[2]]})
	}
	return out
}

func binarySTLCube(s float64) []byte {
	tris := cubeTriangles(s)
	buf := make([]byte, 84+len(tris)*50)
	binary.LittleEndian.PutUint32(buf[80:84], uint32(len(tris)))
	offset := 84
	for _, tri := range tris {
		p := offset + 12
		for v := 0; v < 3; v++ {
			for axis := 0; axis < 3; axis++ {
				binary.LittleEndian.PutUint32(
					buf[p+v*12+axis*4:], math.Float32bits(float32(tri[v][axis])))
			}
		}
		offset += 50
	}
	return buf
}

func asciiSTLCube(s float64) []byte {
	var sb strings.Builder
	sb.WriteString("solid cube\n")
	for _, tri := range cubeTriangles(s) {
		sb.WriteString("  facet normal 0 0 0\n    outer loop\n")
		for _, p := range tri {
			fmt.Fprintf(&sb, "      vertex %v %v %v\n", p[0], p[1], p[2])
		}
		sb.WriteString("    endloop\n  endfacet\n")
	}
	sb.WriteString("endsolid cube\n")
	return []byte(sb.String())
}

func objCube(s float64) []byte {
	tris := cubeTriangles(s)
	index := map[string]int{}
	var order []string
	var sb strings.Builder
	sb.WriteString("# cube\n")
	for _, tri := range tris {
		for _, p := range tri {
			key := fmt.Sprintf("%v,%v,%v", p[0], p[1], p[2])
			if _, ok := index[key]; !ok {
				order = append(order, key)
				index[key] = len(order) // 1-based
				fmt.Fprintf(&sb, "v %v %v %v\n", p[0], p[1], p[2])
			}
		}
	}
	for _, tri := range tris {
		sb.WriteString("f")
		for _, p := range tri {
			fmt.Fprintf(&sb, " %d", index[fmt.Sprintf("%v,%v,%v", p[0], p[1], p[2])])
		}
		sb.WriteString("\n")
	}
	return []byte(sb.String())
}

func buildZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, content := range entries {
		w, err := writer.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return out.Bytes()
}

func slicedThreeMF(t *testing.T, weight, prediction string) []byte {
	t.Helper()
	var meta strings.Builder
	if weight != "" {
		fmt.Fprintf(&meta, `      <metadata key="weight" value="%s"/>`+"\n", weight)
	}
	if prediction != "" {
		fmt.Fprintf(&meta, `      <metadata key="prediction" value="%s"/>`+"\n", prediction)
	}
	xml := `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
` + meta.String() + `      <filament id="1" type="PLA" color="#FFFFFF" used_g="12.5"/>
  </plate>
</config>`
	return buildZip(t, map[string]string{"Metadata/slice_info.config": xml})
}

func meshThreeMF(t *testing.T, s float64, unit, transform string) []byte {
	t.Helper()
	v := [8][3]float64{
		{0, 0, 0}, {s, 0, 0}, {s, s, 0}, {0, s, 0},
		{0, 0, s}, {s, 0, s}, {s, s, s}, {0, s, s},
	}
	faces := [12][3]int{
		{0, 2, 1}, {0, 3, 2}, {4, 5, 6}, {4, 6, 7},
		{0, 1, 5}, {0, 5, 4}, {1, 2, 6}, {1, 6, 5},
		{2, 3, 7}, {2, 7, 6}, {3, 0, 4}, {3, 4, 7},
	}
	var verts, tris strings.Builder
	for _, p := range v {
		fmt.Fprintf(&verts, `          <vertex x="%v" y="%v" z="%v"/>`+"\n", p[0], p[1], p[2])
	}
	for _, f := range faces {
		fmt.Fprintf(&tris, `          <triangle v1="%d" v2="%d" v3="%d"/>`+"\n", f[0], f[1], f[2])
	}
	transformAttr := ""
	if transform != "" {
		transformAttr = fmt.Sprintf(` transform="%s"`, transform)
	}
	xml := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="%s" xml:lang="en-US">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
%s        </vertices>
        <triangles>
%s        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"%s/>
  </build>
</model>`, unit, verts.String(), tris.String(), transformAttr)
	return buildZip(t, map[string]string{"3D/3dmodel.model": xml})
}

// productionThreeMF builds a 3MF in the **production extension** layout that
// Bambu Studio, Orca and MakerWorld actually write: the root part carries NO
// geometry, only an object made of a <component p:path=...> pointing at a
// sibling part in the same zip. This is the common real-world shape, not an edge
// case — see the comment on accumulateObject.
func productionThreeMF(t *testing.T, s float64, transform string, copies int) []byte {
	t.Helper()
	v := [8][3]float64{
		{0, 0, 0}, {s, 0, 0}, {s, s, 0}, {0, s, 0},
		{0, 0, s}, {s, 0, s}, {s, s, s}, {0, s, s},
	}
	faces := [12][3]int{
		{0, 2, 1}, {0, 3, 2}, {4, 5, 6}, {4, 6, 7},
		{0, 1, 5}, {0, 5, 4}, {1, 2, 6}, {1, 6, 5},
		{2, 3, 7}, {2, 7, 6}, {3, 0, 4}, {3, 4, 7},
	}
	var verts, tris strings.Builder
	for _, p := range v {
		fmt.Fprintf(&verts, `<vertex x="%v" y="%v" z="%v"/>`, p[0], p[1], p[2])
	}
	for _, f := range faces {
		fmt.Fprintf(&tris, `<triangle v1="%d" v2="%d" v3="%d"/>`, f[0], f[1], f[2])
	}

	objectPart := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh>
    <vertices>%s</vertices><triangles>%s</triangles>
  </mesh></object></resources>
</model>`, verts.String(), tris.String())

	transformAttr := ""
	if transform != "" {
		transformAttr = fmt.Sprintf(` transform="%s"`, transform)
	}
	var items strings.Builder
	for i := 0; i < copies; i++ {
		items.WriteString(`<item objectid="2"/>`)
	}
	rootPart := fmt.Sprintf(`<?xml version='1.0' encoding='UTF-8'?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
       xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
       unit="millimeter" requiredextensions="p">
  <resources><object id="2" type="model"><components>
    <component p:path="/3D/Objects/object_1.model" objectid="1"%s/>
  </components></object></resources>
  <build>%s</build>
</model>`, transformAttr, items.String())

	return buildZip(t, map[string]string{
		"3D/3dmodel.model":          rootPart,
		"3D/Objects/object_1.model": objectPart,
	})
}

func TestProductionExtensionResolvesComponents(t *testing.T) {
	// Regression: real Bambu/Orca/MakerWorld exports put no geometry in
	// 3D/3dmodel.model at all. Reading only the root part yields zero vertices,
	// which is what made every real .3mf in the queue estimate as "none".
	cfg := DefaultConfig()
	production := FromModel(productionThreeMF(t, side, "", 1), "real.3mf", 1, cfg)
	direct := FromModel(binarySTLCube(side), "cube.stl", 1, cfg)
	if production == nil {
		t.Fatal("a production-extension 3MF must produce an estimate")
	}
	if production.Source != SourceGeometry {
		t.Errorf("source = %q, want %q", production.Source, SourceGeometry)
	}
	if production.Grams != direct.Grams || production.Minutes != direct.Minutes {
		t.Errorf("component-resolved mesh %+v != same cube as STL %+v", *production, *direct)
	}
}

func TestComponentTransformAndRepeatedItemsScale(t *testing.T) {
	cfg := DefaultConfig()
	scaled := FromModel(productionThreeMF(t, side, "2 0 0 0 2 0 0 0 2 0 0 0", 1), "real.3mf", 1, cfg)
	doubled := FromModel(binarySTLCube(side*2), "cube.stl", 1, cfg)
	if scaled == nil || doubled == nil {
		t.Fatal("expected estimates")
	}
	if math.Abs(scaled.Grams-doubled.Grams) > 0.11 {
		t.Errorf("component transform must scale: %.1f vs %.1f", scaled.Grams, doubled.Grams)
	}

	// Two build items of one object share a bounding box but contribute twice
	// the volume; without the instance count this trips the open-mesh guard.
	once := FromModel(productionThreeMF(t, side, "", 1), "real.3mf", 1, cfg)
	twice := FromModel(productionThreeMF(t, side, "", 2), "real.3mf", 1, cfg)
	if once == nil || twice == nil {
		t.Fatal("expected estimates")
	}
	if twice.Source != SourceGeometry {
		t.Errorf("two-up plate misread as %q, want %q", twice.Source, SourceGeometry)
	}
	if math.Abs(twice.Grams-once.Grams*2) > 0.11 {
		t.Errorf("two items must count twice: %.1f vs %.1f", twice.Grams, once.Grams*2)
	}
}

func TestCyclicComponentTerminates(t *testing.T) {
	selfRef := `<?xml version="1.0"?>
<model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources><object id="1" type="model"><components>
    <component objectid="1"/>
  </components></object></resources>
  <build><item objectid="1"/></build>
</model>`
	buf := buildZip(t, map[string]string{"3D/3dmodel.model": selfRef})
	if got := FromModel(buf, "cycle.3mf", 1, DefaultConfig()); got != nil {
		t.Errorf("cyclic reference: got %+v, want nil", *got)
	}
}

// expectedCube recomputes the model independently of geometryToEstimate, so a
// change to the formula has to be made deliberately in both places.
func expectedCube(s float64, pieces int, cfg Config) (float64, int) {
	modelV := s * s * s
	areaMm2 := 6 * s * s
	shellV := math.Min(areaMm2*cfg.ShellMm, modelV)
	materialV := math.Min(math.Max(shellV+(modelV-shellV)*cfg.Infill, modelV*cfg.Infill), modelV)
	layers := math.Max(1, math.Ceil(s/cfg.LayerMm))
	secondsEach := cfg.FixedOverheadS + materialV/cfg.FlowMm3S + layers*cfg.LayerOverheadS
	grams := math.Round((materialV/1000)*cfg.DensityGCm3*float64(pieces)*10) / 10
	minutes := int(math.Round(secondsEach * cfg.TimeFactor * float64(pieces) / 60))
	if minutes < 1 {
		minutes = 1
	}
	return grams, minutes
}

const side = 20.0

func TestBinarySTLCubeMatchesAnalyticVolume(t *testing.T) {
	cfg := DefaultConfig()
	got := FromModel(binarySTLCube(side), "cube.stl", 1, cfg)
	if got == nil {
		t.Fatal("expected an estimate")
	}
	if got.Source != SourceGeometry {
		t.Errorf("source = %q, want %q", got.Source, SourceGeometry)
	}
	wantGrams, wantMinutes := expectedCube(side, 1, cfg)
	if got.Grams != wantGrams || got.Minutes != wantMinutes {
		t.Errorf("got %.1f g / %d min, want %.1f g / %d min",
			got.Grams, got.Minutes, wantGrams, wantMinutes)
	}
}

func TestASCIISTLAndOBJAndMesh3MFAgreeWithBinarySTL(t *testing.T) {
	cfg := DefaultConfig()
	want := FromModel(binarySTLCube(side), "cube.stl", 1, cfg)
	if want == nil {
		t.Fatal("baseline estimate missing")
	}
	cases := map[string]*Result{
		"ascii stl": FromModel(asciiSTLCube(side), "cube.stl", 1, cfg),
		"obj":       FromModel(objCube(side), "cube.obj", 1, cfg),
		"mesh 3mf":  FromModel(meshThreeMF(t, side, "millimeter", ""), "cube.3mf", 1, cfg),
	}
	for name, got := range cases {
		if got == nil {
			t.Errorf("%s: expected an estimate", name)
			continue
		}
		if got.Source != want.Source || got.Grams != want.Grams || got.Minutes != want.Minutes {
			t.Errorf("%s: got %+v, want %+v", name, *got, *want)
		}
	}
}

func TestThreeMFUnitScalesVolume(t *testing.T) {
	cfg := DefaultConfig()
	cm := FromModel(meshThreeMF(t, side, "centimeter", ""), "cube.3mf", 1, cfg)
	mm := FromModel(meshThreeMF(t, side*10, "millimeter", ""), "cube.3mf", 1, cfg)
	if cm == nil || mm == nil {
		t.Fatal("expected estimates")
	}
	if math.Abs(cm.Grams-mm.Grams) > 0.11 {
		t.Errorf("20 cm cube = %.1f g, 200 mm cube = %.1f g — must match", cm.Grams, mm.Grams)
	}
}

func TestThreeMFTransformDeterminantScalesEstimate(t *testing.T) {
	cfg := DefaultConfig()
	scaled := FromModel(meshThreeMF(t, side, "millimeter", "2 0 0 0 2 0 0 0 2 0 0 0"), "cube.3mf", 1, cfg)
	doubled := FromModel(binarySTLCube(side*2), "cube.stl", 1, cfg)
	if scaled == nil || doubled == nil {
		t.Fatal("expected estimates")
	}
	if math.Abs(scaled.Grams-doubled.Grams) > 0.11 {
		t.Errorf("transformed = %.1f g, doubled cube = %.1f g", scaled.Grams, doubled.Grams)
	}
}

func TestSlicedThreeMFWinsOverGeometry(t *testing.T) {
	got := FromModel(slicedThreeMF(t, "42.5", "5400"), "plate.gcode.3mf", 1, DefaultConfig())
	if got == nil {
		t.Fatal("expected an estimate")
	}
	if got.Source != SourceSlicer || got.Grams != 42.5 || got.Minutes != 90 {
		t.Errorf("got %+v, want slicer / 42.5 g / 90 min", *got)
	}
}

func TestSlicedThreeMFSumsPlates(t *testing.T) {
	xml := `<config>
  <plate><metadata key="weight" value="10"/><metadata key="prediction" value="600"/></plate>
  <plate><metadata key="weight" value="5.5"/><metadata key="prediction" value="1200"/></plate>
</config>`
	buf := buildZip(t, map[string]string{"Metadata/slice_info.config": xml})
	got := FromModel(buf, "two-plates.3mf", 1, DefaultConfig())
	if got == nil {
		t.Fatal("expected an estimate")
	}
	if got.Grams != 15.5 || got.Minutes != 30 {
		t.Errorf("got %.1f g / %d min, want 15.5 g / 30 min", got.Grams, got.Minutes)
	}
}

func TestSlicedThreeMFWithoutPredictionKeepsQuantityFallback(t *testing.T) {
	got := FromModel(slicedThreeMF(t, "20", ""), "p.3mf", 2, DefaultConfig())
	if got == nil {
		t.Fatal("expected an estimate")
	}
	if got.Source != SourceSlicer || got.Grams != 40 || got.Minutes != 120 {
		t.Errorf("got %+v, want slicer / 40 g / 120 min", *got)
	}
}

func TestPiecesScaleEstimate(t *testing.T) {
	cfg := DefaultConfig()
	three := FromModel(binarySTLCube(side), "cube.stl", 3, cfg)
	if three == nil {
		t.Fatal("expected an estimate")
	}
	wantGrams, wantMinutes := expectedCube(side, 3, cfg)
	if three.Grams != wantGrams || three.Minutes != wantMinutes {
		t.Errorf("got %.1f g / %d min, want %.1f g / %d min",
			three.Grams, three.Minutes, wantGrams, wantMinutes)
	}
}

func TestOpenMeshFallsBackToBBox(t *testing.T) {
	// A single triangle encloses no volume at all.
	buf := make([]byte, 84+50)
	binary.LittleEndian.PutUint32(buf[80:84], 1)
	tri := [3][3]float64{{0, 0, 0}, {10, 0, 0}, {0, 10, 5}}
	p := 84 + 12
	for v := 0; v < 3; v++ {
		for axis := 0; axis < 3; axis++ {
			binary.LittleEndian.PutUint32(buf[p+v*12+axis*4:], math.Float32bits(float32(tri[v][axis])))
		}
	}
	got := FromModel(buf, "sheet.stl", 1, DefaultConfig())
	if got == nil {
		t.Fatal("expected a bbox estimate")
	}
	if got.Source != SourceBBox || got.Grams <= 0 || got.Minutes <= 0 {
		t.Errorf("got %+v, want a positive bbox estimate", *got)
	}
}

func TestUnusableInputsYieldNil(t *testing.T) {
	cfg := DefaultConfig()
	junk := []byte("this is not a model file at all, not even close")
	for _, name := range []string{"junk.stl", "junk.obj", "junk.3mf"} {
		if got := FromModel(junk, name, 1, cfg); got != nil {
			t.Errorf("%s: got %+v, want nil", name, *got)
		}
	}
	if got := FromModel(binarySTLCube(side), "cube.step", 1, cfg); got != nil {
		t.Errorf("unsupported extension: got %+v, want nil", *got)
	}
	if got := FromModel(nil, "cube.stl", 1, cfg); got != nil {
		t.Errorf("empty buffer: got %+v, want nil", *got)
	}
	small := cfg
	small.MaxBytes = 10
	if got := FromModel(binarySTLCube(side), "cube.stl", 1, small); got != nil {
		t.Errorf("oversized input: got %+v, want nil", *got)
	}
	capped := cfg
	capped.MaxTriangles = 5
	if got := FromModel(binarySTLCube(side), "cube.stl", 1, capped); got != nil {
		t.Errorf("over triangle cap: got %+v, want nil", *got)
	}
}

func TestTimeFactorScalesMinutesOnly(t *testing.T) {
	cfg := DefaultConfig()
	base := FromModel(binarySTLCube(side), "cube.stl", 1, cfg)
	doubled := cfg
	doubled.TimeFactor = 2
	got := FromModel(binarySTLCube(side), "cube.stl", 1, doubled)
	if base == nil || got == nil {
		t.Fatal("expected estimates")
	}
	if got.Grams != base.Grams {
		t.Errorf("TimeFactor changed grams: %.1f vs %.1f", got.Grams, base.Grams)
	}
	if diff := got.Minutes - base.Minutes*2; diff > 1 || diff < -1 {
		t.Errorf("TimeFactor did not double minutes: %d vs %d", got.Minutes, base.Minutes)
	}
}
