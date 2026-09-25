// attributes/GeometryAttribute.js - ported from attributes/geometry_attribute.h/cc

import { DataType } from '../core/DracoTypes.js';

const Type = {
  INVALID: -1,
  POSITION: 0,
  NORMAL: 1,
  COLOR: 2,
  TEX_COORD: 3,
  GENERIC: 4,
  NAMED_ATTRIBUTES_COUNT: 5
};

class GeometryAttribute {

  constructor() {
    this._buffer = null;
    this._numComponents = 1;
    this._dataType = DataType.FLOAT32;
    this._normalized = false;
    this._byteStride = 0;
    this._byteOffset = 0;
    this._attributeType = Type.INVALID;
    this._uniqueId = 0;
  }

  init(attributeType, buffer, numComponents, dataType, normalized, byteStride, byteOffset) {
    this._buffer = buffer;
    this._numComponents = numComponents;
    this._dataType = dataType;
    this._normalized = normalized;
    this._byteStride = byteStride;
    this._byteOffset = byteOffset;
    this._attributeType = attributeType;
  }

  // Returns a Uint8Array view of the buffer starting at the attribute entry.
  getAddress(attIndex) {
    const bytePos = this._byteOffset + this._byteStride * attIndex;
    return this._buffer.data.subarray(bytePos);
  }

  resetBuffer(buffer, byteStride, byteOffset) {
    this._buffer = buffer;
    this._byteStride = byteStride;
    this._byteOffset = byteOffset;
  }

  get attributeType() { return this._attributeType; }

  get dataType() { return this._dataType; }

  get numComponents() { return this._numComponents; }

  get buffer() { return this._buffer; }

  get byteStride() { return this._byteStride; }

  get byteOffset() { return this._byteOffset; }

  get uniqueId() { return this._uniqueId; }
  set uniqueId(id) { this._uniqueId = id; }

}

export { GeometryAttribute, Type as GeometryAttributeType };
