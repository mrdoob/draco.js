// attributes/AttributeQuantizationTransform.js - ported from attributes/attribute_quantization_transform.h/cc

import { AttributeTransform } from './AttributeTransform.js';
import { AttributeTransformType } from './AttributeTransformType.js';
import { DataType } from '../core/DracoTypes.js';
import { Dequantizer } from '../core/QuantizationUtils.js';

class AttributeQuantizationTransform extends AttributeTransform {

  constructor() {
    super();
    this._quantizationBits = -1;
    this._minValues = [];
    this._range = 0;
  }

  copyToAttributeTransformData(outData) {
    outData.transformType = AttributeTransformType.QUANTIZATION_TRANSFORM;
    outData.appendParameterValue(this._quantizationBits, 'int32');
    for (let i = 0; i < this._minValues.length; i++) {
      outData.appendParameterValue(this._minValues[i], 'float32');
    }
    outData.appendParameterValue(this._range, 'float32');
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

  inverseTransformAttribute(attribute, targetAttribute) {
    if (targetAttribute.dataType !== DataType.FLOAT32) {
      return false;
    }

    const maxQuantizedValue = ((1 << this._quantizationBits) >>> 0) - 1;
    const numComponents = targetAttribute.numComponents;
    const dequantizer = new Dequantizer();
    if (!dequantizer.initFromRange(this._range, maxQuantizedValue)) {
      return false;
    }

    const numValues = targetAttribute.size;
    const total = numValues * numComponents;
    const delta = dequantizer.delta;
    const minValues = this._minValues;

    // The portable (source) attribute holds native-endian int32; the target
    // holds float32. Attribute buffers start at byteOffset 0, so typed-array
    // views are aligned -- read/write through them directly to avoid a
    // per-component DataView dispatch and a per-entry buffer copy.
    const srcAddr = attribute.getAddress(0);
    const srcI32 = new Int32Array(srcAddr.buffer, srcAddr.byteOffset, total);
    const dstAddr = targetAttribute.getAddress(0);
    const dstF32 = new Float32Array(dstAddr.buffer, dstAddr.byteOffset, total);

    // Mirror Draco C++ float32 arithmetic so the result is bit-identical to the
    // WASM decoder: `value` (int) is converted to float, multiplied by the
    // float `delta` (both rounded to float32), then added to the float32 min.
    // The Float32Array store performs the final round of the addition.
    const fround = Math.fround;

    // Specialize nc=3/2 (positions/texcoords) with minValues hoisted to locals;
    // same operands/order as the generic path below, so bit-identical.
    if (numComponents === 3) {
      const m0 = minValues[0], m1 = minValues[1], m2 = minValues[2];
      for (let o = 0; o < total; o += 3) {
        dstF32[o] = fround(fround(srcI32[o]) * delta) + m0;
        dstF32[o + 1] = fround(fround(srcI32[o + 1]) * delta) + m1;
        dstF32[o + 2] = fround(fround(srcI32[o + 2]) * delta) + m2;
      }
      return true;
    }
    if (numComponents === 2) {
      const m0 = minValues[0], m1 = minValues[1];
      for (let o = 0; o < total; o += 2) {
        dstF32[o] = fround(fround(srcI32[o]) * delta) + m0;
        dstF32[o + 1] = fround(fround(srcI32[o + 1]) * delta) + m1;
      }
      return true;
    }

    let o = 0;
    for (let i = 0; i < numValues; i++) {
      for (let c = 0; c < numComponents; c++) {
        dstF32[o] = fround(fround(srcI32[o]) * delta) + minValues[c];
        o++;
      }
    }
    return true;
  }

  static _isQuantizationValid(quantizationBits) {
    return quantizationBits >= 1 && quantizationBits <= 30;
  }

}

export { AttributeQuantizationTransform };
