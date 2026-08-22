package printestimate

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"math"
	"strconv"
	"strings"
)

// readZipEntry returns the decompressed bytes of one named entry, or nil.
func readZipEntry(buf []byte, name string) []byte {
	reader, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		return nil
	}
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return nil
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil
		}
		return data
	}
	return nil
}

// ── sliced project files ─────────────────────────────────────────────────────

type sliceInfoMetadataXML struct {
	Key   string `xml:"key,attr"`
	Value string `xml:"value,attr"`
}

type sliceInfoPlateXML struct {
	Metadata []sliceInfoMetadataXML `xml:"metadata"`
}

type sliceInfoConfigXML struct {
	Plates []sliceInfoPlateXML `xml:"plate"`
}

// SliceInfo is the slicer's own answer for an already-sliced 3MF: filament
// weight in grams and predicted print time in seconds, each summed across
// plates. Either may be absent on its own — a project file can carry a weight
// with no prediction — so the caller decides what is usable.
type SliceInfo struct {
	Grams      float64
	HasGrams   bool
	Seconds    float64
	HasSeconds bool
}

// ExtractSliceInfo reads Metadata/slice_info.config out of a 3MF. Returns nil
// when the buffer carries no slice info at all (a raw mesh-only 3MF, which the
// geometry path handles instead).
func ExtractSliceInfo(buf []byte) *SliceInfo {
	data := readZipEntry(buf, "Metadata/slice_info.config")
	if data == nil {
		return nil
	}
	var config sliceInfoConfigXML
	if err := xml.Unmarshal(data, &config); err != nil {
		return nil
	}

	info := &SliceInfo{}
	for _, plate := range config.Plates {
		for _, meta := range plate.Metadata {
			value, err := strconv.ParseFloat(strings.TrimSpace(meta.Value), 64)
			if err != nil || value <= 0 || math.IsInf(value, 0) {
				continue
			}
			switch strings.ToLower(meta.Key) {
			case "weight":
				info.Grams += value
				info.HasGrams = true
			case "prediction":
				info.Seconds += value
				info.HasSeconds = true
			}
		}
	}
	if !info.HasGrams && !info.HasSeconds {
		return nil
	}
	info.Grams = math.Round(info.Grams*10) / 10
	info.Seconds = math.Round(info.Seconds)
	return info
}

// ── mesh-only 3MF ────────────────────────────────────────────────────────────

// 3MF core spec length units. `unit` defaults to millimetre, which is what every
// slicer writes, but honouring it costs almost nothing and a metre-unit file
// would otherwise be off by 10^9 in volume.
var unitToMm = map[string]float64{
	"micron":     0.001,
	"millimeter": 1,
	"centimeter": 10,
	"inch":       25.4,
	"foot":       304.8,
	"meter":      1000,
}

type modelVertexXML struct {
	X float64 `xml:"x,attr"`
	Y float64 `xml:"y,attr"`
	Z float64 `xml:"z,attr"`
}

type modelTriangleXML struct {
	V1 int `xml:"v1,attr"`
	V2 int `xml:"v2,attr"`
	V3 int `xml:"v3,attr"`
}

type modelMeshXML struct {
	Vertices  []modelVertexXML   `xml:"vertices>vertex"`
	Triangles []modelTriangleXML `xml:"triangles>triangle"`
}

// modelComponentXML is the 3MF production extension's cross-part reference.
// Path is the `p:path` attribute; encoding/xml matches it by local name, so the
// namespace prefix does not need declaring here.
type modelComponentXML struct {
	ObjectID  string `xml:"objectid,attr"`
	Path      string `xml:"path,attr"`
	Transform string `xml:"transform,attr"`
}

type modelObjectXML struct {
	ID         string              `xml:"id,attr"`
	Mesh       modelMeshXML        `xml:"mesh"`
	Components []modelComponentXML `xml:"components>component"`
}

type modelItemXML struct {
	ObjectID  string `xml:"objectid,attr"`
	Path      string `xml:"path,attr"`
	Transform string `xml:"transform,attr"`
}

type modelXML struct {
	Unit    string           `xml:"unit,attr"`
	Objects []modelObjectXML `xml:"resources>object"`
	Items   []modelItemXML   `xml:"build>item"`
}

// transformDeterminant returns the determinant of the 3×3 linear part of a 3MF
// item transform (a row-major list of 12 numbers: three basis vectors then a
// translation). Translation does not affect volume, so it is ignored.
func transformDeterminant(transform string) float64 {
	fields := strings.Fields(transform)
	if len(fields) < 9 {
		return 1
	}
	var n [9]float64
	for i := 0; i < 9; i++ {
		value, err := strconv.ParseFloat(fields[i], 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return 1
		}
		n[i] = value
	}
	det := n[0]*(n[4]*n[8]-n[5]*n[7]) -
		n[1]*(n[3]*n[8]-n[5]*n[6]) +
		n[2]*(n[3]*n[7]-n[4]*n[6])
	if det == 0 || math.IsNaN(det) || math.IsInf(det, 0) {
		return 1
	}
	return det
}

const modelRootPart = "3D/3dmodel.model"

// Depth cap on the component graph. Real files nest one level (root object →
// component → object in another part); this only has to stop a malicious or
// broken file from recursing forever, alongside the cycle guard below.
const maxComponentDepth = 8

// normalizePartPath turns a p:path ("/3D/Objects/object_1.model", absolute
// within the archive) into a zip entry name, which has no leading slash. An
// absent path means "same part".
func normalizePartPath(path, fallback string) string {
	if path == "" {
		return fallback
	}
	return strings.TrimLeft(path, "/")
}

// meshContext carries the archive plus the per-part and per-object memo tables
// for one parse.
type meshContext struct {
	buf   []byte
	cfg   Config
	parts map[string]*modelXML
	cache map[string]*accumulator
}

// loadPart reads and unmarshals one .model part, memoised — a part holding a
// repeated object is referenced once per copy.
func (ctx *meshContext) loadPart(path string) *modelXML {
	if part, ok := ctx.parts[path]; ok {
		return part
	}
	var part *modelXML
	if data := readZipEntry(ctx.buf, path); data != nil {
		var parsed modelXML
		if err := xml.Unmarshal(data, &parsed); err == nil {
			part = &parsed
		}
	}
	ctx.parts[path] = part
	return part
}

func (ctx *meshContext) findObject(path, id string) *modelObjectXML {
	part := ctx.loadPart(path)
	if part == nil {
		return nil
	}
	for i := range part.Objects {
		if part.Objects[i].ID == id {
			return &part.Objects[i]
		}
	}
	return nil
}

// accumulateMesh sums the <mesh> written directly inside one <object>.
func accumulateMesh(object *modelObjectXML, cfg Config) *accumulator {
	verts := object.Mesh.Vertices
	if len(verts) == 0 {
		return nil
	}
	acc := newAccumulator()
	for _, tri := range object.Mesh.Triangles {
		if tri.V1 < 0 || tri.V2 < 0 || tri.V3 < 0 ||
			tri.V1 >= len(verts) || tri.V2 >= len(verts) || tri.V3 >= len(verts) {
			continue
		}
		a, b, c := verts[tri.V1], verts[tri.V2], verts[tri.V3]
		acc.add([3]float64{a.X, a.Y, a.Z}, [3]float64{b.X, b.Y, b.Z}, [3]float64{c.X, c.Y, c.Z})
		if acc.triangles > cfg.MaxTriangles {
			return nil
		}
	}
	if acc.triangles == 0 {
		return nil
	}
	acc.instances = 1
	return acc
}

// accumulateObject resolves one object to a finished accumulator, following
// <component> references.
//
// This is what the 3MF **production extension** requires, and it is the common
// case in the wild rather than an edge case: Bambu Studio, Orca and MakerWorld
// all write a root 3D/3dmodel.model containing NO geometry at all — only
// <object>s made of <component p:path="/3D/Objects/object_N.model" objectid="…"
// transform="…"/> pointing at sibling parts inside the same zip. A parser that
// reads the root part alone finds zero vertices and gives up.
func (ctx *meshContext) accumulateObject(partPath, objectID string, depth int) *accumulator {
	if depth > maxComponentDepth {
		return nil
	}
	key := partPath + "#" + objectID
	if cached, ok := ctx.cache[key]; ok {
		return cached
	}
	// Seed the cache before recursing so a cyclic reference resolves to nothing
	// rather than looping.
	ctx.cache[key] = nil

	object := ctx.findObject(partPath, objectID)
	if object == nil {
		return nil
	}

	acc := accumulateMesh(object, ctx.cfg)
	if acc == nil {
		total := newAccumulator()
		placed := 0
		for _, component := range object.Components {
			if component.ObjectID == "" {
				continue
			}
			childPath := normalizePartPath(component.Path, partPath)
			child := ctx.accumulateObject(childPath, component.ObjectID, depth+1)
			if child == nil {
				continue
			}
			total.merge(child.clone().scale(transformDeterminant(component.Transform)))
			placed++
		}
		if placed > 0 {
			acc = total
		}
	}

	ctx.cache[key] = acc
	return acc
}

// parse3mfMesh handles a 3MF carrying real geometry (exported from CAD, or a
// MakerWorld/Bambu project that has not been sliced). It walks <build> and
// resolves each item through the component graph above.
func parse3mfMesh(buf []byte, cfg Config) *geometry {
	ctx := &meshContext{
		buf:   buf,
		cfg:   cfg,
		parts: map[string]*modelXML{},
		cache: map[string]*accumulator{},
	}
	root := ctx.loadPart(modelRootPart)
	if root == nil {
		return nil
	}

	total := newAccumulator()
	placed := 0
	for _, item := range root.Items {
		if item.ObjectID == "" {
			continue
		}
		path := normalizePartPath(item.Path, modelRootPart)
		acc := ctx.accumulateObject(path, item.ObjectID, 0)
		if acc == nil {
			continue
		}
		total.merge(acc.clone().scale(transformDeterminant(item.Transform)))
		placed++
	}

	// No usable <build> section: count every root object once.
	if placed == 0 {
		for i := range root.Objects {
			acc := ctx.accumulateObject(modelRootPart, root.Objects[i].ID, 0)
			if acc == nil {
				continue
			}
			total.merge(acc.clone())
			placed++
		}
	}
	if placed == 0 {
		return nil
	}

	unitScale, ok := unitToMm[strings.ToLower(strings.TrimSpace(root.Unit))]
	if !ok {
		unitScale = 1
	}
	return total.scale(unitScale * unitScale * unitScale).finish()
}
