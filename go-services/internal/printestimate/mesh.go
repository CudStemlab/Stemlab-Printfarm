package printestimate

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"math"
	"strconv"
	"strings"
)

// ── STL ──────────────────────────────────────────────────────────────────────

// parseBinarySTL reads the 80-byte header, a uint32 facet count, then 50 bytes
// per facet (3 floats normal + 9 floats vertices + uint16 attribute count). The
// normal is skipped: it is unreliable in the wild and unused here.
func parseBinarySTL(buf []byte, cfg Config) *geometry {
	if len(buf) < 84 {
		return nil
	}
	count := int(binary.LittleEndian.Uint32(buf[80:84]))
	if count == 0 || count > cfg.MaxTriangles {
		return nil
	}
	if 84+count*50 > len(buf) {
		return nil
	}

	acc := newAccumulator()
	offset := 84
	for i := 0; i < count; i++ {
		p := offset + 12
		var tri [3][3]float64
		for v := 0; v < 3; v++ {
			for axis := 0; axis < 3; axis++ {
				bits := binary.LittleEndian.Uint32(buf[p+v*12+axis*4:])
				tri[v][axis] = float64(math.Float32frombits(bits))
			}
		}
		acc.add(tri[0], tri[1], tri[2])
		offset += 50
	}
	return acc.finish()
}

func parseASCIISTL(buf []byte, cfg Config) *geometry {
	acc := newAccumulator()
	var pending [][3]float64

	scanner := bufio.NewScanner(bytes.NewReader(buf))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(strings.ToLower(line), "vertex") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			return nil
		}
		var p [3]float64
		for axis := 0; axis < 3; axis++ {
			value, err := strconv.ParseFloat(fields[axis+1], 64)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				return nil
			}
			p[axis] = value
		}
		pending = append(pending, p)
		if len(pending) == 3 {
			acc.add(pending[0], pending[1], pending[2])
			pending = pending[:0]
			if acc.triangles > cfg.MaxTriangles {
				return nil
			}
		}
	}
	if scanner.Err() != nil {
		return nil
	}
	return acc.finish()
}

// parseSTL sniffs binary vs ASCII the way three.js's STLLoader does: the
// declared facet count matching the byte length is the real test, because some
// exporters write "solid" at the head of a binary file.
func parseSTL(buf []byte, cfg Config) *geometry {
	if len(buf) >= 84 {
		count := int(binary.LittleEndian.Uint32(buf[80:84]))
		if count > 0 && 84+count*50 == len(buf) {
			return parseBinarySTL(buf, cfg)
		}
	}
	if len(buf) >= 5 && strings.EqualFold(string(buf[:5]), "solid") {
		return parseASCIISTL(buf, cfg)
	}
	return parseBinarySTL(buf, cfg)
}

// ── OBJ ──────────────────────────────────────────────────────────────────────

// parseOBJ reads `v x y z` vertices (1-based; negative indices count back from
// the end) and `f` faces of any arity, fan-triangulated. Only the position
// component of each face element (`v`, `v/vt`, `v//vn`) matters here.
func parseOBJ(buf []byte, cfg Config) *geometry {
	var verts [][3]float64
	acc := newAccumulator()

	scanner := bufio.NewScanner(bytes.NewReader(buf))
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "v "), strings.HasPrefix(line, "v\t"):
			fields := strings.Fields(line)
			if len(fields) < 4 {
				continue
			}
			var p [3]float64
			ok := true
			for axis := 0; axis < 3; axis++ {
				value, err := strconv.ParseFloat(fields[axis+1], 64)
				if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
					ok = false
					break
				}
				p[axis] = value
			}
			if ok {
				verts = append(verts, p)
			}
		case strings.HasPrefix(line, "f "), strings.HasPrefix(line, "f\t"):
			fields := strings.Fields(line)
			idx := make([]int, 0, len(fields))
			for _, field := range fields[1:] {
				raw, err := strconv.Atoi(strings.SplitN(field, "/", 2)[0])
				if err != nil || raw == 0 {
					continue
				}
				resolved := raw - 1
				if raw < 0 {
					resolved = len(verts) + raw
				}
				if resolved < 0 || resolved >= len(verts) {
					continue
				}
				idx = append(idx, resolved)
			}
			for i := 2; i < len(idx); i++ {
				acc.add(verts[idx[0]], verts[idx[i-1]], verts[idx[i]])
				if acc.triangles > cfg.MaxTriangles {
					return nil
				}
			}
		}
	}
	if scanner.Err() != nil {
		return nil
	}
	return acc.finish()
}
