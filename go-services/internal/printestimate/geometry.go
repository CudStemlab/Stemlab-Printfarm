package printestimate

import "math"

// accumulator holds running totals over a triangle soup. Volume is the
// signed-tetrahedron sum (correct for any closed surface regardless of
// convexity); area is the sum of triangle areas; the bounds give the model
// height, which drives the layer count.
type accumulator struct {
	volume6x  float64 // sum of v0 · (v1 × v2); divided by 6 at the end
	area2x    float64 // sum of |(v1-v0) × (v2-v0)|; halved at the end
	triangles int
	min       [3]float64
	max       [3]float64
}

func newAccumulator() *accumulator {
	return &accumulator{
		min: [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)},
		max: [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)},
	}
}

func (a *accumulator) add(v0, v1, v2 [3]float64) {
	a.volume6x += v0[0]*(v1[1]*v2[2]-v1[2]*v2[1]) +
		v0[1]*(v1[2]*v2[0]-v1[0]*v2[2]) +
		v0[2]*(v1[0]*v2[1]-v1[1]*v2[0])

	ux, uy, uz := v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]
	vx, vy, vz := v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]
	nx := uy*vz - uz*vy
	ny := uz*vx - ux*vz
	nz := ux*vy - uy*vx
	a.area2x += math.Sqrt(nx*nx + ny*ny + nz*nz)

	a.triangles++
	for _, p := range [3][3]float64{v0, v1, v2} {
		for axis := 0; axis < 3; axis++ {
			if p[axis] < a.min[axis] {
				a.min[axis] = p[axis]
			}
			if p[axis] > a.max[axis] {
				a.max[axis] = p[axis]
			}
		}
	}
}

// scale applies a transform's determinant (or a unit conversion expressed as
// s³). A linear scale s multiplies volume by s³ and area by s². For a general
// 3×3 transform only the determinant is available, so volume is exact and area
// uses det^(2/3) as an isotropic approximation.
func (a *accumulator) scale(det float64) *accumulator {
	factor := math.Abs(det)
	if math.IsInf(factor, 0) || math.IsNaN(factor) || factor == 1 {
		return a
	}
	a.volume6x *= factor
	a.area2x *= math.Cbrt(factor * factor)
	linear := math.Cbrt(factor)
	for axis := 0; axis < 3; axis++ {
		a.min[axis] *= linear
		a.max[axis] *= linear
	}
	return a
}

func (a *accumulator) merge(other *accumulator) {
	a.volume6x += other.volume6x
	a.area2x += other.area2x
	a.triangles += other.triangles
	for axis := 0; axis < 3; axis++ {
		a.min[axis] = math.Min(a.min[axis], other.min[axis])
		a.max[axis] = math.Max(a.max[axis], other.max[axis])
	}
}

func (a *accumulator) clone() *accumulator {
	copied := *a
	return &copied
}

// geometry is the finished, unit-bearing summary a mesh parser returns.
type geometry struct {
	VolumeMm3 float64
	AreaMm2   float64
	Triangles int
	Width     float64
	Depth     float64
	Height    float64
}

func (a *accumulator) finish() *geometry {
	if a.triangles == 0 || math.IsInf(a.min[2], 0) {
		return nil
	}
	return &geometry{
		VolumeMm3: math.Abs(a.volume6x) / 6,
		AreaMm2:   a.area2x / 2,
		Triangles: a.triangles,
		Width:     a.max[0] - a.min[0],
		Depth:     a.max[1] - a.min[1],
		Height:    a.max[2] - a.min[2],
	}
}
