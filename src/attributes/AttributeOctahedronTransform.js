// attributes/AttributeOctahedronTransform.js - ported from attributes/attribute_octahedron_transform.h/cc

import { DataType } from '../core/DracoTypes.js';
// Reuse the shared OctahedronToolBox (decode math is identical) instead of a hand-synced inline copy.
import { OctahedronToolBox } from '../compression/attributes/NormalCompressionUtils.js';

class AttributeOctahedronTransform {

  constructor() {
    this._quantizationBits = -1;
  }

  decodeParameters(attribute, decoderBuffer) {
    const qBits = decoderBuffer.decodeUint8();
    if (qBits === undefined) return false;
    this._quantizationBits = qBits;
    return true;
  }

  inverseTransformAttribute(attribute, targetAttribute) {
    if (targetAttribute.dataType !== DataType.FLOAT32) {
      return false;
    }

    const numPoints = targetAttribute.size;
    const numComponents = targetAttribute.numComponents;
    if (numComponents !== 3) {
      return false;
    }

    const toolBox = new OctahedronToolBox();
    if (!toolBox.setQuantizationBits(this._quantizationBits)) {
      return false;
    }

    // Source holds native-endian int32 octahedral coords (2 per point); target
    // holds float32 unit vectors (3 per point). Attribute buffers start at
    // byteOffset 0, so typed-array views are aligned -- read/write directly,
    // avoiding a per-point DataView dispatch and per-entry buffer copy.
    const srcAddr = attribute.getAddress(0);
    const srcI32 = new Int32Array(srcAddr.buffer, srcAddr.byteOffset, numPoints * 2);
    const dstAddr = targetAttribute.getAddress(0);
    const dstF32 = new Float32Array(dstAddr.buffer, dstAddr.byteOffset, numPoints * 3);

    const outVec = this._tmpVec || (this._tmpVec = new Float32Array(3));
    let si = 0;
    let di = 0;
    for (let i = 0; i < numPoints; i++) {
      toolBox.quantizedOctahedralCoordsToUnitVector(srcI32[si], srcI32[si + 1], outVec);
      si += 2;
      dstF32[di] = outVec[0];
      dstF32[di + 1] = outVec[1];
      dstF32[di + 2] = outVec[2];
      di += 3;
    }
    return true;
  }

}

export { AttributeOctahedronTransform };
