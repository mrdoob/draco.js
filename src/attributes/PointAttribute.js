// Decoder-owned attribute record. Values stay in encoded entry order; the
// original type and optional transform are applied only to requested output.
import { dataTypeLength } from '../core/DracoTypes.js';
import { kInvalidAttributeValueIndex } from './GeometryIndices.js';

const AttributeArrays = {
  1: Int8Array, 2: Uint8Array, 3: Int16Array, 4: Uint16Array,
  5: Int32Array, 6: Uint32Array, 9: Float32Array, 10: Float64Array,
};

class PointAttribute {
  constructor(attributeType, dataType, numComponents, normalized) {
    this.attributeType = attributeType;
    this.dataType = dataType;
    this.numComponents = numComponents;
    this.normalized = normalized;
    this.uniqueId = 0;
    this.size = 0;
    this.values = null;
    this.portable = false;
    this.portableComponents = numComponents;
    this.transform = null;
    this.indicesMap = null;
  }

  get isMappingIdentity() { return this.indicesMap === null; }

  setIdentityMapping() { this.indicesMap = null; }

  setExplicitMapping(numPoints) {
    this.indicesMap = new Uint32Array(numPoints);
    this.indicesMap.fill(kInvalidAttributeValueIndex);
  }

  extractTo(OutputTypedArray, numPoints, map = this.indicesMap) {
    const nc = this.numComponents;
    const output = new OutputTypedArray(numPoints * nc);
    const values = this.values;
    if (values === null || numPoints === 0) return output;
    if (this.transform !== null) {
      this.transform.extractTo(values, map, output, nc);
      return output;
    }

    // Raw INT64/UINT64/BOOL conversion was unsupported by the old scalar
    // accessor and yielded zero. Keep that behavior while consuming its bytes.
    if (!AttributeArrays[this.dataType]) return output;

    if (this.portable) {
      // Reconstruct the ORIGINAL integer width/sign before converting to the
      // requested array. Portable Int32 values are also used by later predictors
      // and must not be narrowed or overwritten in place.
      const shift = 32 - dataTypeLength(this.dataType) * 8;
      const unsigned = this.dataType % 2 === 0;
      for (let p = 0, d = 0; p < numPoints; p++) {
        const s = (map === null ? p : map[p]) * nc;
        for (let c = 0; c < nc; c++, d++) {
          const value = values[s + c];
          output[d] = value === undefined ? value
            : unsigned ? (value << shift) >>> shift : (value << shift) >> shift;
        }
      }
      return output;
    }

    if (map === null) {
      output.set(values.subarray(0, output.length));
    } else if (nc === 3) {
      for (let p = 0, d = 0; p < numPoints; p++, d += 3) {
        const s = map[p] * 3;
        output[d] = values[s]; output[d + 1] = values[s + 1]; output[d + 2] = values[s + 2];
      }
    } else if (nc === 2) {
      for (let p = 0, d = 0; p < numPoints; p++, d += 2) {
        const s = map[p] * 2;
        output[d] = values[s]; output[d + 1] = values[s + 1];
      }
    } else {
      for (let p = 0, d = 0; p < numPoints; p++) {
        const s = map[p] * nc;
        for (let c = 0; c < nc; c++) output[d++] = values[s + c];
      }
    }
    return output;
  }
}

// Prediction parents are the same records, read in portable integer form.
// The parent map is immutable after sequencing; no second map or buffer exists.
function buildInt32PositionCache(attribute, pointIds, numEntries) {
  const values = attribute.values;
  const map = attribute.indicesMap;
  const cache = new Int32Array(numEntries * 3);
  for (let i = 0, d = 0; i < numEntries; i++, d += 3) {
    const point = pointIds[i];
    const s = (map === null ? point : map[point]) * 3;
    cache[d] = values[s]; cache[d + 1] = values[s + 1]; cache[d + 2] = values[s + 2];
  }
  return cache;
}

export { PointAttribute, AttributeArrays, buildInt32PositionCache };
