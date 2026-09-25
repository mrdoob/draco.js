// attributes/AttributeOctahedronTransform.js - ported from attributes/attribute_octahedron_transform.h/cc

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

  init() {
    this._toolBox = new OctahedronToolBox();
    return this._toolBox.setQuantizationBits(this._quantizationBits);
  }

  extractTo(values, map, output) {
    const count = output.length / 3;
    for (let p = 0, d = 0; p < count; p++, d += 3) {
      const s = (map === null ? p : map[p]) * 2;
      // The toolbox explicitly rounds every result to FLOAT32, including when
      // output is an integer array. No intermediate normal vector is needed.
      this._toolBox.quantizedOctahedralCoordsToUnitVector(values[s], values[s + 1], output, d);
    }
  }

}

export { AttributeOctahedronTransform };
