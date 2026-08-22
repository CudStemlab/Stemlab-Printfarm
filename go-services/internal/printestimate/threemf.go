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

type modelObjectXML struct {
	ID   string       `xml:"id,attr"`
	Mesh modelMeshXML `xml:"mesh"`
}

type modelItemXML struct {
	ObjectID  string `xml:"objectid,attr"`
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

// parse3mfMesh handles a 3MF exported from CAD rather than sliced, reading
// 3D/3dmodel.model. Each <object> is accumulated separately so a build <item>'s
// transform scales only that object's contribution.
func parse3mfMesh(buf []byte, cfg Config) *geometry {
	data := readZipEntry(buf, "3D/3dmodel.model")
	if data == nil {
		return nil
	}
	var model modelXML
	if err := xml.Unmarshal(data, &model); err != nil {
		return nil
	}

	byID := make(map[string]*accumulator, len(model.Objects))
	for _, object := range model.Objects {
		acc := newAccumulator()
		verts := object.Mesh.Vertices
		for _, tri := range object.Mesh.Triangles {
			if tri.V1 < 0 || tri.V2 < 0 || tri.V3 < 0 ||
				tri.V1 >= len(verts) || tri.V2 >= len(verts) || tri.V3 >= len(verts) {
				continue
			}
			a := verts[tri.V1]
			b := verts[tri.V2]
			c := verts[tri.V3]
			acc.add([3]float64{a.X, a.Y, a.Z}, [3]float64{b.X, b.Y, b.Z}, [3]float64{c.X, c.Y, c.Z})
			if acc.triangles > cfg.MaxTriangles {
				return nil
			}
		}
		if acc.triangles > 0 && object.ID != "" {
			byID[object.ID] = acc
		}
	}
	if len(byID) == 0 {
		return nil
	}

	// Build items reference objects, possibly several times and with transforms.
	// A file with no <build> section (or with unresolvable references) falls back
	// to counting every object once.
	total := newAccumulator()
	placed := 0
	for _, item := range model.Items {
		source, ok := byID[item.ObjectID]
		if !ok {
			continue
		}
		total.merge(source.clone().scale(transformDeterminant(item.Transform)))
		placed++
	}
	if placed == 0 {
		for _, acc := range byID {
			total.merge(acc)
		}
	}

	unitScale, ok := unitToMm[strings.ToLower(strings.TrimSpace(model.Unit))]
	if !ok {
		unitScale = 1
	}
	return total.scale(unitScale * unitScale * unitScale).finish()
}
