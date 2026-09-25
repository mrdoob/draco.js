// attributes/AttributeQuantizationTransform.js - ported from attributes/attribute_quantization_transform.h/cc

import { Dequantizer } from '../core/QuantizationUtils.js';

class AttributeQuantizationTransform {

  constructor() {
    this._quantizationBits = -1;
    this._minValues = [];
    this._range = 0;
  }

  decodeParameters(attribute, decoderBuffer) {
    const numComponents = attribute.numComponents;
    this._minValues = new Array(numComponents);

    for (let i = 0; i < numComponents; i++) {
      const val = decoderBuffer.decodeFloat32();
      if (val === undefined) return false;
      this._minValues[i] = val;
    }

    const range = decoderBuffer.decodeFloat32();
    if (range === undefined) return false;
    this._range = range;

    const qBits = decoderBuffer.decodeUint8();
    if (qBits === undefined) return false;
    if (!AttributeQuantizationTransform._isQuantizationValid(qBits)) {
      return false;
    }
    this._quantizationBits = qBits;
    return true;
  }

  init() {
    const maxQuantizedValue = ((1 << this._quantizationBits) >>> 0) - 1;
    const dequantizer = new Dequantizer();
    if (!dequantizer.initFromRange(this._range, maxQuantizedValue)) return false;
    this._delta = dequantizer.delta;
    return true;
  }

  extractTo(values, map, output, nc) {
    const count = output.length / nc;
    const delta = this._delta;
    const min = this._minValues;
    const fround = Math.fround;
    // The original attribute was FLOAT32 even when the caller requests integer
    // output: round the final addition BEFORE the destination's conversion.
    if (nc === 3) {
      const m0 = min[0], m1 = min[1], m2 = min[2];
      for (let p = 0, d = 0; p < count; p++, d += 3) {
        const s = (map === null ? p : map[p]) * 3;
        output[d] = fround(fround(fround(values[s]) * delta) + m0);
        output[d + 1] = fround(fround(fround(values[s + 1]) * delta) + m1);
        output[d + 2] = fround(fround(fround(values[s + 2]) * delta) + m2);
      }
    } else if (nc === 2) {
      const m0 = min[0], m1 = min[1];
      for (let p = 0, d = 0; p < count; p++, d += 2) {
        const s = (map === null ? p : map[p]) * 2;
        output[d] = fround(fround(fround(values[s]) * delta) + m0);
        output[d + 1] = fround(fround(fround(values[s + 1]) * delta) + m1);
      }
    } else {
      for (let p = 0, d = 0; p < count; p++) {
        const s = (map === null ? p : map[p]) * nc;
        for (let c = 0; c < nc; c++) {
          output[d++] = fround(fround(fround(values[s + c]) * delta) + min[c]);
        }
      }
    }
  }

  static _isQuantizationValid(quantizationBits) {
    return quantizationBits >= 1 && quantizationBits <= 30;
  }

}

export { AttributeQuantizationTransform };
