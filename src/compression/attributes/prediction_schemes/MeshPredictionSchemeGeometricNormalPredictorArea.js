// compression/attributes/prediction_schemes/MeshPredictionSchemeGeometricNormalPredictorArea.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_geometric_normal_predictor_area.h
// and mesh_prediction_scheme_geometric_normal_predictor_base.h

import { buildInt32PositionCache } from '../../../attributes/PointAttribute.js';

const UPPER_BOUND = 1 << 29;

/**
 * Predictor that estimates the normal via the surrounding triangles of a
 * given corner, weighted by triangle area.
 */
class MeshPredictionSchemeGeometricNormalPredictorArea {

  constructor(meshData) {
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._meshData = meshData;
    this._posCache = null;            // flat Int32 positions, indexed by data id
    this._cornerToVertex = null;
    this._oppositeCorners = null;
    this._cornerToOffset = null;      // corner -> posCache offset, precomputed
  }

  setPositionAttribute(positionAttribute) {
    this._posAttribute = positionAttribute;
  }

  setEntryToPointIdMap(map) {
    this._entryToPointIdMap = map;
  }

  buildPositionCache(numEntries) {
    this._posCache = buildInt32PositionCache(
      this._posAttribute, this._entryToPointIdMap, numEntries);
    const table = this._meshData.cornerTable;
    this._cornerToVertex = table.cornerToVertexArray();
    this._oppositeCorners = table.oppositeCornerArray();
    // Precompute corner -> posCache offset once so the ring walk folds the
    // vertexToDataMap[cornerToVertex[c]]*3 double indirection into one load.
    const cornerToVertex = this._cornerToVertex;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const nc = cornerToVertex.length;
    const c2o = new Int32Array(nc);
    for (let c = 0; c < nc; ++c) {
      const v = cornerToVertex[c];
      c2o[c] = v < 0 ? -1 : vertexToDataMap[v] * 3;
    }
    this._cornerToOffset = c2o;
  }

  computePredictedValue(cornerId, prediction) {
    const oppositeCorners = this._oppositeCorners;
    const cornerToOffset = this._cornerToOffset;
    const posCache = this._posCache;
    const centerOffset = cornerToOffset[cornerId];
    const centX = posCache[centerOffset];
    const centY = posCache[centerOffset + 1];
    const centZ = posCache[centerOffset + 2];

    let normalX = 0, normalY = 0, normalZ = 0;

    // Draco 2.2 uses TRIANGLE_AREA: visit every corner around the vertex like C++
    // VertexCornersIterator -- swing LEFT to a boundary/full loop, then (only
    // if an open boundary was hit) swing RIGHT for the other side. Right-only
    // would drop triangles left of the start corner on boundary vertices.
    let currentCorner = cornerId;
    let leftTraversal = true;

    while (currentCorner >= 0) {
      const rem = currentCorner - ((currentCorner / 3) | 0) * 3;
      const cNext = rem === 2 ? currentCorner - 2 : currentCorner + 1;
      const cPrev = rem === 0 ? currentCorner + 2 : currentCorner - 1;
      let posOffset = cornerToOffset[cNext];
      const nextX = posCache[posOffset];
      const nextY = posCache[posOffset + 1];
      const nextZ = posCache[posOffset + 2];
      posOffset = cornerToOffset[cPrev];
      const prevX = posCache[posOffset];
      const prevY = posCache[posOffset + 1];
      const prevZ = posCache[posOffset + 2];

      const dNextX = nextX - centX;
      const dNextY = nextY - centY;
      const dNextZ = nextZ - centZ;
      const dPrevX = prevX - centX;
      const dPrevY = prevY - centY;
      const dPrevZ = prevZ - centZ;

      normalX += dNextY * dPrevZ - dNextZ * dPrevY;
      normalY += dNextZ * dPrevX - dNextX * dPrevZ;
      normalZ += dNextX * dPrevY - dNextY * dPrevX;

      // Advance like VertexCornersIterator::Next().
      if (leftTraversal) {
        const opp = oppositeCorners[cNext];
        if (opp < 0) {
          currentCorner = -1;
        } else {
          const oppRem = opp - ((opp / 3) | 0) * 3;
          currentCorner = oppRem === 2 ? opp - 2 : opp + 1;
        }
        if (currentCorner < 0) {
          // Open boundary reached; cover the other side from the start.
          const startRem = cornerId - ((cornerId / 3) | 0) * 3;
          const startPrev = startRem === 0 ? cornerId + 2 : cornerId - 1;
          const startOpp = oppositeCorners[startPrev];
          if (startOpp < 0) {
            currentCorner = -1;
          } else {
            const startOppRem = startOpp - ((startOpp / 3) | 0) * 3;
            currentCorner = startOppRem === 0 ? startOpp + 2 : startOpp - 1;
          }
          leftTraversal = false;
        } else if (currentCorner === cornerId) {
          // Returned to the start: full ring visited.
          currentCorner = -1;
        }
      } else {
        const opp = oppositeCorners[cPrev];
        if (opp < 0) {
          currentCorner = -1;
        } else {
          const oppRem = opp - ((opp / 3) | 0) * 3;
          currentCorner = oppRem === 0 ? opp + 2 : opp - 1;
        }
      }
    }

    // Clamp to int32 with int64 INTEGER division like C++: quotient floored,
    // each component truncated toward zero. Naive float division diverges for
    // UPPER_BOUND < absSum < 2*UPPER_BOUND, where C++ quotient is 1 (no change).
    const absSum = Math.abs(normalX) + Math.abs(normalY) + Math.abs(normalZ);
    if (absSum > UPPER_BOUND) {
      const quotient = Math.floor(absSum / UPPER_BOUND);
      normalX = Math.trunc(normalX / quotient);
      normalY = Math.trunc(normalY / quotient);
      normalZ = Math.trunc(normalZ / quotient);
    }

    prediction[0] = Math.trunc(normalX);
    prediction[1] = Math.trunc(normalY);
    prediction[2] = Math.trunc(normalZ);
  }

}

export { MeshPredictionSchemeGeometricNormalPredictorArea };
