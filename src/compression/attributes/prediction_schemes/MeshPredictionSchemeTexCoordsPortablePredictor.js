// compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsPortablePredictor.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_portable_predictor.h

import { DataType } from '../../../core/DracoTypes.js';

// 2^53: integer products below this are exact as a JS double; at or above it
// the double path may lose precision and we switch to the BigInt path.
const SAFE_PRODUCT = 9007199254740992;

const MASK64 = (1n << 64n) - 1n;
const INT64_MAX_BIG = (1n << 63n) - 1n;

// Floor of the integer square root of a non-negative BigInt; matches C++ IntSqrt.
function bigIntSqrt(value) {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

// Precompute every entry's integer position into a flat Int32Array (the JS-port
// form of the C++ predictor's per-call GetPositionForEntryId()).
function buildInt32PositionCache(att, map, numEntries, tempPos) {
  const cache = new Int32Array(numEntries * 3);
  const bufData = att.buffer && att.buffer.data;

  if (att.dataType === DataType.INT32 && att.numComponents === 3 && bufData) {
    const src = new Int32Array(bufData.buffer);
    const srcStart = (bufData.byteOffset + att.byteOffset) >> 2;
    const stride = att.byteStride >> 2;
    const isIdentity = att.isMappingIdentity;
    const indicesMap = att.indicesMap;
    if (isIdentity) {
      for (let d = 0; d < numEntries; ++d) {
        const srcOffset = srcStart + map[d] * stride;
        const o = d * 3;
        cache[o] = src[srcOffset];
        cache[o + 1] = src[srcOffset + 1];
        cache[o + 2] = src[srcOffset + 2];
      }
    } else {
      for (let d = 0; d < numEntries; ++d) {
        const srcOffset = srcStart + indicesMap[map[d]] * stride;
        const o = d * 3;
        cache[o] = src[srcOffset];
        cache[o + 1] = src[srcOffset + 1];
        cache[o + 2] = src[srcOffset + 2];
      }
    }
  } else {
    for (let d = 0; d < numEntries; ++d) {
      att.convertValue(att.mappedIndex(map[d]), tempPos);
      const o = d * 3;
      cache[o] = tempPos[0];
      cache[o + 1] = tempPos[1];
      cache[o + 2] = tempPos[2];
    }
  }
  return cache;
}

/**
 * Predictor functionality used for portable UV prediction by both encoder and
 * decoder. This implements only the decoder path (is_encoder_t = false).
 */
class MeshPredictionSchemeTexCoordsPortablePredictor {

  static NUM_COMPONENTS = 2;

  constructor(meshData) {
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._predictedValue = new Int32Array(2);
    this._orientations = new Uint8Array(0);
    this._numOrientations = 0;
    this._meshData = meshData;
    this._tempPos = new Array(3);
    // Flat Int32 position cache so fetches are array reads, not convertValue calls.
    this._posCache = null;
    this._cornerToVertex = null;
  }

  setPositionAttribute(positionAttribute) {
    this._posAttribute = positionAttribute;
  }

  setEntryToPointIdMap(map) {
    this._entryToPointIdMap = map;
  }

  get predictedValue() {
    return this._predictedValue;
  }

  resizeOrientations(numOrientations) {
    this._orientations = new Uint8Array(numOrientations);
    this._numOrientations = numOrientations;
  }

  setOrientation(i, v) {
    this._orientations[i] = v ? 1 : 0;
  }

  buildPositionCache(numEntries) {
    this._posCache = buildInt32PositionCache(
      this._posAttribute, this._entryToPointIdMap, numEntries, this._tempPos);
    this._cornerToVertex = this._meshData.cornerTable.cornerToVertexArray();
  }

  computePredictedValue(cornerId, data, dataId) {
    const rem = cornerId - ((cornerId / 3) | 0) * 3;
    const nextCornerId = rem === 2 ? cornerId - 2 : cornerId + 1;
    const prevCornerId = rem === 0 ? cornerId + 2 : cornerId - 1;

    const cornerToVertex = this._cornerToVertex;
    const nextVertId = cornerToVertex[nextCornerId];
    const prevVertId = cornerToVertex[prevCornerId];

    const vertexToDataMap = this._meshData.vertexToDataMap;
    const nextDataId = vertexToDataMap[nextVertId];
    const prevDataId = vertexToDataMap[prevVertId];

    if (prevDataId < dataId && nextDataId < dataId) {
      const nDataOff = nextDataId * 2;
      const pDataOff = prevDataId * 2;
      const nUV0 = data[nDataOff], nUV1 = data[nDataOff + 1];
      const pUV0 = data[pDataOff], pUV1 = data[pDataOff + 1];

      if (pUV0 === nUV0 && pUV1 === nUV1) {
        this._predictedValue[0] = pUV0;
        this._predictedValue[1] = pUV1;
        return true;
      }

      const posCache = this._posCache;
      let posOffset = dataId * 3;
      const tip0 = posCache[posOffset];
      const tip1 = posCache[posOffset + 1];
      const tip2 = posCache[posOffset + 2];
      posOffset = nextDataId * 3;
      const next0 = posCache[posOffset];
      const next1 = posCache[posOffset + 1];
      const next2 = posCache[posOffset + 2];
      posOffset = prevDataId * 3;
      const prev0 = posCache[posOffset];
      const prev1 = posCache[posOffset + 1];
      const prev2 = posCache[posOffset + 2];

      const pn0 = prev0 - next0;
      const pn1 = prev1 - next1;
      const pn2 = prev2 - next2;
      const pnNorm2Squared = pn0 * pn0 + pn1 * pn1 + pn2 * pn2;

      if (pnNorm2Squared !== 0) {
        const cn0 = tip0 - next0;
        const cn1 = tip1 - next1;
        const cn2 = tip2 - next2;
        const cnDotPn = pn0 * cn0 + pn1 * cn1 + pn2 * cn2;

        const pnUV0 = pUV0 - nUV0;
        const pnUV1 = pUV1 - nUV1;

        const INT64_MAX = 9223372036854775807;
        const nUVAbsMax = Math.max(Math.abs(nUV0), Math.abs(nUV1));
        if (nUVAbsMax > INT64_MAX / pnNorm2Squared) {
          return false;
        }

        const pnUVAbsMax = Math.max(Math.abs(pnUV0), Math.abs(pnUV1));
        if (pnUVAbsMax > 0 && Math.abs(cnDotPn) > INT64_MAX / pnUVAbsMax) {
          return false;
        }

        // Remaining arithmetic is int64 in C++. With small quantized positions
        // every intermediate fits 2^53 so double math is bit-exact; high
        // quantization (e.g. cl10's 20-bit) overflows 2^53 and we drop to the
        // BigInt path mirroring C++ int64/uint64. Products that can exceed 2^53:
        // nUV*pnNorm2, cnDotPn*pnUV, cnDotPn*pn, and cxNorm2*pnNorm2 (the last
        // bounded by cnNorm2*pnNorm2, since cx is never longer than cn).
        const cnNorm2 = cn0 * cn0 + cn1 * cn1 + cn2 * cn2;
        const pnAbsMaxG = Math.max(Math.abs(pn0), Math.abs(pn1), Math.abs(pn2));
        const cnDotPnAbs = Math.abs(cnDotPn);
        if (cnNorm2 > SAFE_PRODUCT / pnNorm2Squared ||
            nUVAbsMax > SAFE_PRODUCT / pnNorm2Squared ||
            (pnUVAbsMax > 0 && cnDotPnAbs > SAFE_PRODUCT / pnUVAbsMax) ||
            (pnAbsMaxG > 0 && cnDotPnAbs > SAFE_PRODUCT / pnAbsMaxG)) {
          return this._computePredictedValueBig(
            tip0, tip1, tip2, next0, next1, next2,
            pn0, pn1, pn2, nUV0, nUV1, pUV0, pUV1, pnNorm2Squared);
        }

        // x_uv = nUV * pnNorm2Squared + cnDotPn * pnUV
        const xUV0 = nUV0 * pnNorm2Squared + cnDotPn * pnUV0;
        const xUV1 = nUV1 * pnNorm2Squared + cnDotPn * pnUV1;

        const pnAbsMax = Math.max(Math.abs(pn0), Math.abs(pn1), Math.abs(pn2));
        if (pnAbsMax > 0 && Math.abs(cnDotPn) > INT64_MAX / pnAbsMax) {
          return false;
        }

        // x_pos = nextPos + (cnDotPn * pn) / pnNorm2Squared
        const xPos0 = next0 + Math.trunc((cnDotPn * pn0) / pnNorm2Squared);
        const xPos1 = next1 + Math.trunc((cnDotPn * pn1) / pnNorm2Squared);
        const xPos2 = next2 + Math.trunc((cnDotPn * pn2) / pnNorm2Squared);
        const cx0 = tip0 - xPos0;
        const cx1 = tip1 - xPos1;
        const cx2 = tip2 - xPos2;
        const cxNorm2Squared = cx0 * cx0 + cx1 * cx1 + cx2 * cx2;

        // Rotated pnUV by 90 degrees.
        const normSquared = Math.floor(Math.sqrt(cxNorm2Squared * pnNorm2Squared));
        const cxUV0 = pnUV1 * normSquared;
        const cxUV1 = -pnUV0 * normSquared;

        if (this._numOrientations === 0) {
          return false;
        }
        const orientation = this._orientations[--this._numOrientations];

        if (orientation) {
          this._predictedValue[0] = Math.trunc((xUV0 + cxUV0) / pnNorm2Squared);
          this._predictedValue[1] = Math.trunc((xUV1 + cxUV1) / pnNorm2Squared);
        } else {
          this._predictedValue[0] = Math.trunc((xUV0 - cxUV0) / pnNorm2Squared);
          this._predictedValue[1] = Math.trunc((xUV1 - cxUV1) / pnNorm2Squared);
        }
        return true;
      }
    }

    // Fallback: delta coding.
    let dataOffset = 0;
    if (prevDataId < dataId) {
      dataOffset = prevDataId * 2;
    }
    if (nextDataId < dataId) {
      dataOffset = nextDataId * 2;
    } else {
      if (dataId > 0) {
        dataOffset = (dataId - 1) * 2;
      } else {
        this._predictedValue[0] = 0;
        this._predictedValue[1] = 0;
        return true;
      }
    }
    this._predictedValue[0] = data[dataOffset];
    this._predictedValue[1] = data[dataOffset + 1];
    return true;
  }

  // 64-bit-exact projection prediction, used when the double path would lose
  // precision (high position quantization). Mirrors C++ VectorD<int64_t>/
  // <uint64_t>, including the uint64 wraparound in IntSqrt(cxNorm2*pnNorm2) and
  // the unsigned add/sub forming the final UV. Returns false in the same
  // overflow cases as the double path so encoder and decoder agree on fallback.
  _computePredictedValueBig(tip0, tip1, tip2, next0, next1, next2,
    pn0, pn1, pn2, nUV0, nUV1, pUV0, pUV1, pnNorm2SquaredNum) {
    const B = BigInt;
    const tip = [B(tip0), B(tip1), B(tip2)];
    const nxt = [B(next0), B(next1), B(next2)];
    const pn = [B(pn0), B(pn1), B(pn2)];
    const nUVb0 = B(nUV0), nUVb1 = B(nUV1);
    const pnN2 = B(pnNorm2SquaredNum);

    const cn0 = tip[0] - nxt[0];
    const cn1 = tip[1] - nxt[1];
    const cn2 = tip[2] - nxt[2];
    const cnDotPn = pn[0] * cn0 + pn[1] * cn1 + pn[2] * cn2;
    const pnUV0 = B(pUV0) - nUVb0;
    const pnUV1 = B(pUV1) - nUVb1;

    const babs = (x) => (x < 0n ? -x : x);
    const nUVAbsMax = babs(nUVb0) > babs(nUVb1) ? babs(nUVb0) : babs(nUVb1);
    if (nUVAbsMax > INT64_MAX_BIG / pnN2) return false;
    let pnUVAbsMax = babs(pnUV0) > babs(pnUV1) ? babs(pnUV0) : babs(pnUV1);
    if (pnUVAbsMax > 0n && babs(cnDotPn) > INT64_MAX_BIG / pnUVAbsMax) return false;

    // x_uv = nUV * pnNorm2 + cnDotPn * pnUV (int64 vector; wraps on overflow).
    const xUV0 = B.asIntN(64, nUVb0 * pnN2 + cnDotPn * pnUV0);
    const xUV1 = B.asIntN(64, nUVb1 * pnN2 + cnDotPn * pnUV1);

    let pnAbsMax = babs(pn[0]);
    if (babs(pn[1]) > pnAbsMax) pnAbsMax = babs(pn[1]);
    if (babs(pn[2]) > pnAbsMax) pnAbsMax = babs(pn[2]);
    if (pnAbsMax > 0n && babs(cnDotPn) > INT64_MAX_BIG / pnAbsMax) return false;

    // x_pos = next + (cnDotPn * pn) / pnNorm2 (signed truncating division).
    const xPos0 = nxt[0] + (cnDotPn * pn[0]) / pnN2;
    const xPos1 = nxt[1] + (cnDotPn * pn[1]) / pnN2;
    const xPos2 = nxt[2] + (cnDotPn * pn[2]) / pnN2;
    const cx0 = tip[0] - xPos0;
    const cx1 = tip[1] - xPos1;
    const cx2 = tip[2] - xPos2;
    const cxNorm2 = cx0 * cx0 + cx1 * cx1 + cx2 * cx2;

    // norm_squared = IntSqrt(cxNorm2 * pnNorm2), with the multiply in uint64.
    const normSquared = bigIntSqrt((cxNorm2 * pnN2) & MASK64);

    // cx_uv = Rot(pnUV) * normSquared (int64; wraps on overflow).
    const cxUV0 = B.asIntN(64, pnUV1 * normSquared);
    const cxUV1 = B.asIntN(64, (-pnUV0) * normSquared);

    if (this._numOrientations === 0) return false;
    const orientation = this._orientations[--this._numOrientations];

    // predicted_uv = (uint64(x_uv) +/- uint64(cx_uv)) / pnNorm2, as int64,
    // then truncated to int32 (static_cast<int>).
    let s0, s1;
    if (orientation) {
      s0 = B.asUintN(64, B.asUintN(64, xUV0) + B.asUintN(64, cxUV0));
      s1 = B.asUintN(64, B.asUintN(64, xUV1) + B.asUintN(64, cxUV1));
    } else {
      s0 = B.asUintN(64, B.asUintN(64, xUV0) - B.asUintN(64, cxUV0));
      s1 = B.asUintN(64, B.asUintN(64, xUV1) - B.asUintN(64, cxUV1));
    }
    this._predictedValue[0] = Number(B.asIntN(32, B.asIntN(64, s0) / pnN2));
    this._predictedValue[1] = Number(B.asIntN(32, B.asIntN(64, s1) / pnN2));
    return true;
  }

}

export { MeshPredictionSchemeTexCoordsPortablePredictor };
