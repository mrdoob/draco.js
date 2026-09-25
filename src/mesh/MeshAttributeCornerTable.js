// mesh/MeshAttributeCornerTable.js - ported from mesh/mesh_attribute_corner_table.h/cc

const kInvalidCornerIndex = -1;
const kInvalidVertexIndex = -1;

class MeshAttributeCornerTable {

  constructor() {

    this.is_edge_on_seam_ = [];
    this.is_vertex_on_seam_ = [];
    this.no_interior_seams_ = true;
    this.corner_to_vertex_map_ = [];
    this.vertex_to_left_most_corner_map_ = [];
    this.corner_table_ = null;

  }

  initEmpty(table) {

    if (table === null) {
      return false;
    }

    // Only seam flags are needed before recomputation or adoption of an
    // identical seam layout. Delay the corner map until recomputation is needed.
    this.is_edge_on_seam_ = new Uint8Array(table.numCorners());
    this.is_vertex_on_seam_ = new Uint8Array(table.numVertices());
    this.corner_to_vertex_map_ = null;
    this.vertex_to_left_most_corner_map_ = [];
    // Lazily built; see oppositeCornerArray.
    this._effectiveOpposite = null;
    this._hasCompactBaseVertices = false;
    this.corner_table_ = table;
    this.no_interior_seams_ = true;
    return true;

  }

  addSeamEdge(c) {

    const cornerToVertex = this.corner_table_.cornerToVertexArray();
    const oppositeCorners = this.corner_table_.oppositeCornerArray();
    const isEdge = this.is_edge_on_seam_;
    const isVert = this.is_vertex_on_seam_;

    isEdge[c] = 1;
    // Inlined next(c)/previous(c).
    let rem = c - ((c / 3) | 0) * 3;
    isVert[cornerToVertex[rem === 2 ? c - 2 : c + 1]] = 1;
    isVert[cornerToVertex[rem === 0 ? c + 2 : c - 1]] = 1;

    const oppCorner = oppositeCorners[c];
    if (oppCorner !== kInvalidCornerIndex) {

      this.no_interior_seams_ = false;
      isEdge[oppCorner] = 1;
      rem = oppCorner - ((oppCorner / 3) | 0) * 3;
      isVert[cornerToVertex[rem === 2 ? oppCorner - 2 : oppCorner + 1]] = 1;
      isVert[cornerToVertex[rem === 0 ? oppCorner + 2 : oppCorner - 1]] = 1;

    }

  }

  recomputeVertices() {

    this._hasCompactBaseVertices = false;
    if (this.no_interior_seams_ && this._recomputeBaseVertices()) {
      return true;
    }
    return this._recomputeVerticesInternal();

  }

  // With boundary seams only, attribute vertices are the non-isolated base
  // vertices in ascending order. Preserve that dense numbering with a flat
  // remap instead of walking each vertex ring.
  _recomputeBaseVertices() {

    const ct = this.corner_table_;
    const numVertices = ct.numVertices();
    const numCorners = ct.numCorners();
    const baseCorners = ct.cornerToVertexArray();
    const baseOpposite = ct.oppositeCornerArray();
    const baseLeftmost = ct.vertexLeftmostCornerArray();
    const compact = new Int32Array(numVertices).fill(kInvalidVertexIndex);
    let numNewVertices = 0;

    for (let v = 0; v < numVertices; ++v) {
      const c = baseLeftmost[v];
      if (c === kInvalidCornerIndex) continue;
      if (c < 0 || c >= numCorners || baseCorners[c] !== v) return false;
      // CornerTable guarantees a boundary vertex's leftmost corner is at its
      // boundary end. Keep the original ring walk for unusual input that does
      // not satisfy that invariant, including its malformed-cycle rejection.
      if (this.is_vertex_on_seam_[v]) {
        const next = c % 3 === 2 ? c - 2 : c + 1;
        if (baseOpposite[next] !== kInvalidCornerIndex) return false;
      }
      compact[v] = numNewVertices++;
    }

    const cornerToVertex = new Int32Array(numCorners);
    for (let c = 0; c < numCorners; ++c) {
      const v = baseCorners[c];
      if (v < 0 || v >= numVertices || compact[v] === kInvalidVertexIndex) {
        return false;
      }
      cornerToVertex[c] = compact[v];
    }
    const leftmost = new Int32Array(numNewVertices);
    for (let v = 0; v < numVertices; ++v) {
      if (compact[v] !== kInvalidVertexIndex) {
        leftmost[compact[v]] = baseLeftmost[v];
      }
    }

    this.corner_to_vertex_map_ = cornerToVertex;
    this.vertex_to_left_most_corner_map_ = leftmost;
    // Boundary opposites are already -1, so no seam-masked copy is needed.
    this._effectiveOpposite = baseOpposite;
    this._hasCompactBaseVertices = true;
    return true;

  }

  // Only the C++ RecomputeVertices(nullptr, nullptr) path: the decoder always
  // rebuilds the attribute-vertex maps from connectivity alone.
  _recomputeVerticesInternal() {

    const ct = this.corner_table_;
    const numCorners = ct.numCorners();
    const numBaseVertices = ct.numVertices();
    // Preallocate leftMostMap by new-vertex id (new-vertex count <= numCorners).
    const leftMostMap = new Int32Array(numCorners);
    const cornerToVertex = new Int32Array(numCorners).fill(kInvalidVertexIndex);
    this.corner_to_vertex_map_ = cornerToVertex;
    const isVertexOnSeam = this.is_vertex_on_seam_;
    const isEdgeOnSeam = this.is_edge_on_seam_;
    // Flat connectivity arrays so the per-corner swings inline to typed-array
    // arithmetic instead of polymorphic dispatch.
    //   - seamOpp: seam-aware opposite (== this.opposite), used by swingLeft.
    //   - baseOpp: raw opposite of the underlying table, used by swingRight
    //     (matches corner_table_.swingRight, which is NOT seam-aware here).
    // Both are final: all seams were added before recomputeVertices() runs.
    const seamOpp = this.oppositeCornerArray();
    const baseOpp = ct.oppositeCornerArray();
    const vertexLeftmost = ct.vertexLeftmostCornerArray();
    let numNewVertices = 0;

    for (let v = 0; v < numBaseVertices; ++v) {
      const c = vertexLeftmost[v];
      if (c === kInvalidCornerIndex) continue;

      if (!isVertexOnSeam[v]) {
        const firstVertId = numNewVertices++;
        leftMostMap[firstVertId] = c;
        cornerToVertex[c] = firstVertId;

        let pv = (c % 3 === 0) ? c + 2 : c - 1;
        let bopp = baseOpp[pv];
        let actC = bopp < 0 ? kInvalidCornerIndex : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        while (actC !== kInvalidCornerIndex && actC !== c) {
          cornerToVertex[actC] = firstVertId;
          pv = (actC % 3 === 0) ? actC + 2 : actC - 1;
          bopp = baseOpp[pv];
          actC = bopp < 0 ? kInvalidCornerIndex : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        }
      } else {
        let firstVertId = numNewVertices++;

        let firstC = c;
        let actC;

        let nx = (firstC % 3 === 2) ? firstC - 2 : firstC + 1;
        let opp = seamOpp[nx];
        actC = opp < 0 ? kInvalidCornerIndex : ((opp % 3 === 2) ? opp - 2 : opp + 1);
        while (actC !== kInvalidCornerIndex) {
          firstC = actC;
          nx = (firstC % 3 === 2) ? firstC - 2 : firstC + 1;
          opp = seamOpp[nx];
          actC = opp < 0 ? kInvalidCornerIndex : ((opp % 3 === 2) ? opp - 2 : opp + 1);
          if (actC === c) return false;
        }

        cornerToVertex[firstC] = firstVertId;
        leftMostMap[firstVertId] = firstC;

        let pv = (firstC % 3 === 0) ? firstC + 2 : firstC - 1;
        let bopp = baseOpp[pv];
        actC = bopp < 0 ? kInvalidCornerIndex : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        while (actC !== kInvalidCornerIndex && actC !== firstC) {
          const nAct = (actC % 3 === 2) ? actC - 2 : actC + 1;
          if (isEdgeOnSeam[nAct]) {
            firstVertId = numNewVertices++;
            leftMostMap[firstVertId] = actC;
          }
          cornerToVertex[actC] = firstVertId;
          pv = (actC % 3 === 0) ? actC + 2 : actC - 1;
          bopp = baseOpp[pv];
          actC = bopp < 0 ? kInvalidCornerIndex : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        }
      }
    }

    // subarray, not copy: exact-length view so accessors see the right length.
    this.vertex_to_left_most_corner_map_ = leftMostMap.subarray(0, numNewVertices);

    return true;

  }

  isCornerOppositeToSeamEdge(corner) {

    return this.is_edge_on_seam_[corner];

  }

  opposite(corner) {

    if (corner === kInvalidCornerIndex || this.isCornerOppositeToSeamEdge(corner)) {
      return kInvalidCornerIndex;
    }

    return this.corner_table_.opposite(corner);

  }

  next(corner) {

    return this.corner_table_.next(corner);

  }

  previous(corner) {

    return this.corner_table_.previous(corner);

  }


  swingRight(corner) {

    return this.previous(this.opposite(this.previous(corner)));

  }

  swingLeft(corner) {

    return this.next(this.opposite(this.next(corner)));

  }

  numVertices() {

    return this.vertex_to_left_most_corner_map_.length;

  }

  numFaces() {

    return this.corner_table_.numFaces();

  }

  numCorners() {

    return this.corner_table_.numCorners();

  }

  // --- Flat-array accessors: let DepthFirstTraverser avoid per-corner dispatch. ---

  cornerToVertexArray() {
    return this.corner_to_vertex_map_;
  }

  // Seam-aware opposite corners (seam edges -> -1), matching opposite(). Cached on
  // first use; seams and connectivity are finalized before traversal, so it's stable.
  oppositeCornerArray() {
    if (this._effectiveOpposite === null) {
      const nc = this.corner_table_.numCorners();
      const eff = new Int32Array(nc);
      const seam = this.is_edge_on_seam_;
      const ct = this.corner_table_;
      for (let c = 0; c < nc; ++c) {
        eff[c] = seam[c] ? kInvalidCornerIndex : ct.opposite(c);
      }
      this._effectiveOpposite = eff;
    }
    return this._effectiveOpposite;
  }

  vertexLeftmostCornerArray() {
    return this.vertex_to_left_most_corner_map_;
  }

  // Per-base-vertex seam flag (Uint8Array); exposed so hot dedup loops inline the lookup.
  vertexOnSeamArray() {
    return this.is_vertex_on_seam_;
  }

  hasSameSeams(other) {
    if (other === null || other === undefined) return false;
    const seamA = this.is_edge_on_seam_;
    const seamB = other.is_edge_on_seam_;
    if (seamA.length !== seamB.length) return false;
    for (let i = 0, l = seamA.length; i < l; ++i) {
      if (seamA[i] !== seamB[i]) return false;
    }
    return true;
  }

  adoptVertexRecompute(other) {
    this.corner_to_vertex_map_ = other.corner_to_vertex_map_;
    this.vertex_to_left_most_corner_map_ = other.vertex_to_left_most_corner_map_;
    this.no_interior_seams_ = other.no_interior_seams_;
    this._effectiveOpposite = other._effectiveOpposite;
    this._hasCompactBaseVertices = other._hasCompactBaseVertices;
  }

}

export { MeshAttributeCornerTable };
