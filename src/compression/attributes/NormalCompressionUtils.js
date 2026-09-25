// compression/attributes/NormalCompressionUtils.js - ported from compression/attributes/normal_compression_utils.h

// Converts unit vectors to/from octahedral coordinates for normal compression.
// Invariants: maxQuantizedValue = 2^q - 1 (odd); maxValue = maxQuantizedValue - 1
// (even); centerValue = maxValue / 2.
class OctahedronToolBox {

  constructor() {
    this._quantizationBits = -1;
    this._maxQuantizedValue = -1;
    this._maxValue = -1;
    this._dequantizationScale = 1.0;
    this._centerValue = -1;
  }

  // q: quantization bits, valid range 2..30.
  setQuantizationBits(q) {
    if (q < 2 || q > 30) return false;
    this._quantizationBits = q;
    this._maxQuantizedValue = (1 << q) - 1;
    this._maxValue = this._maxQuantizedValue - 1;
    this._dequantizationScale = Math.fround(2.0 / Math.fround(this._maxValue));
    this._centerValue = (this._maxValue / 2) | 0;
    return true;
  }

  quantizationBits() { return this._quantizationBits; }

  // Canonicalizes edge points into consistent quadrants. Writes result into
  // out[0], out[1] (caller-owned reusable 2-element array).
  canonicalizeOctahedralCoords(s, t, out) {
    if ((s === 0 && t === 0) || (s === 0 && t === this._maxValue) ||
        (s === this._maxValue && t === 0)) {
      s = this._maxValue;
      t = this._maxValue;
    } else if (s === 0 && t > this._centerValue) {
      t = this._centerValue - (t - this._centerValue);
    } else if (s === this._maxValue && t < this._centerValue) {
      t = this._centerValue + (this._centerValue - t);
    } else if (t === this._maxValue && s < this._centerValue) {
      s = this._centerValue + (this._centerValue - s);
    } else if (t === 0 && s > this._centerValue) {
      s = this._centerValue - (s - this._centerValue);
    }
    out[0] = s;
    out[1] = t;
  }

  // Precondition: abs sum of intVec ([x,y,z]) must equal centerValue.
  // Writes result to out[0], out[1].
  integerVectorToQuantizedOctahedralCoords(intVec, out) {
    let s, t;
    if (intVec[0] >= 0) {
      s = intVec[1] + this._centerValue;
      t = intVec[2] + this._centerValue;
    } else {
      if (intVec[1] < 0) {
        s = Math.abs(intVec[2]);
      } else {
        s = this._maxValue - Math.abs(intVec[2]);
      }
      if (intVec[2] < 0) {
        t = Math.abs(intVec[1]);
      } else {
        t = this._maxValue - Math.abs(intVec[1]);
      }
    }
    this.canonicalizeOctahedralCoords(s, t, out);
  }

  // Normalizes vec ([x,y,z], modified in place) so its abs sum equals centerValue.
  canonicalizeIntegerVector(vec) {
    const absSum = Math.abs(vec[0]) + Math.abs(vec[1]) + Math.abs(vec[2]);
    if (absSum === 0) {
      vec[0] = this._centerValue;
      // vec[1] and vec[2] remain 0.
    } else {
      vec[0] = Math.trunc((vec[0] * this._centerValue) / absSum);
      vec[1] = Math.trunc((vec[1] * this._centerValue) / absSum);
      if (vec[2] >= 0) {
        vec[2] = this._centerValue - Math.abs(vec[0]) - Math.abs(vec[1]);
      } else {
        vec[2] = -(this._centerValue - Math.abs(vec[0]) - Math.abs(vec[1]));
      }
    }
  }

  quantizedOctahedralCoordsToUnitVector(inS, inT, outVector, offset = 0) {
    // float32 throughout (Math.fround) to stay bit-identical to the WASM
    // decoder, matching the live copy in AttributeOctahedronTransform.js.
    const fround = Math.fround;
    this._octahedralCoordsToUnitVector(
      fround(fround(fround(inS) * this._dequantizationScale) - 1.0),
      fround(fround(fround(inT) * this._dequantizationScale) - 1.0),
      outVector, offset
    );
  }

  _octahedralCoordsToUnitVector(inSScaled, inTScaled, outVector, offset) {
    // float32 throughout (see quantizedOctahedralCoordsToUnitVector) so normals
    // are bit-identical to WASM.
    const fround = Math.fround;
    let y = inSScaled;
    let z = inTScaled;
    const x = fround(fround(1.0 - Math.abs(y)) - Math.abs(z));

    let xOffset = -x;
    if (xOffset < 0) xOffset = 0;

    y = fround(y + (y < 0 ? xOffset : -xOffset));
    z = fround(z + (z < 0 ? xOffset : -xOffset));

    const normSquared = fround(fround(fround(x * x) + fround(y * y)) + fround(z * z));
    if (normSquared < 1e-6) {
      outVector[offset + 0] = 0;
      outVector[offset + 1] = 0;
      outVector[offset + 2] = 0;
    } else {
      const d = fround(1.0 / fround(Math.sqrt(normSquared)));
      outVector[offset + 0] = fround(x * d);
      outVector[offset + 1] = fround(y * d);
      outVector[offset + 2] = fround(z * d);
    }
  }

}

export { OctahedronToolBox };
