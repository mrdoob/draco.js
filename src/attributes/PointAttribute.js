// attributes/PointAttribute.js - ported from attributes/point_attribute.h/cc

import { GeometryAttribute } from './GeometryAttribute.js';
import { DataBuffer } from '../core/DataBuffer.js';
import { DataType, dataTypeLength } from '../core/DracoTypes.js';
import { kInvalidAttributeValueIndex } from './GeometryIndices.js';

class PointAttribute extends GeometryAttribute {

  constructor(geometryAttribute) {
    super();
    this._identityMapping = false;
    this._numUniqueEntries = 0;
    this._indicesMap = [];
    this._attributeBuffer = null;
    this._attributeTransformData = null;

    if (geometryAttribute instanceof GeometryAttribute) {
      this._buffer = geometryAttribute._buffer;
      this._numComponents = geometryAttribute._numComponents;
      this._dataType = geometryAttribute._dataType;
      this._normalized = geometryAttribute._normalized;
      this._byteStride = geometryAttribute._byteStride;
      this._byteOffset = geometryAttribute._byteOffset;
      this._attributeType = geometryAttribute._attributeType;
      this._uniqueId = geometryAttribute._uniqueId;
    }
  }

  reset(numAttributeValues) {
    if (this._attributeBuffer === null) {
      this._attributeBuffer = new DataBuffer();
    }
    const entrySize = dataTypeLength(this.dataType) * this.numComponents;
    this._attributeBuffer.update(null, numAttributeValues * entrySize);
    this.resetBuffer(this._attributeBuffer, entrySize, 0);
    this._numUniqueEntries = numAttributeValues;
    return true;
  }

  get size() {
    return this._numUniqueEntries;
  }

  mappedIndex(pointIndex) {
    if (this._identityMapping) {
      return pointIndex;
    }
    return this._indicesMap[pointIndex];
  }

  get isMappingIdentity() {
    return this._identityMapping;
  }

  get indicesMapSize() {
    if (this._identityMapping) {
      return 0;
    }
    return this._indicesMap.length;
  }

  // Direct access to the explicit point->value index map (Uint32Array after
  // setExplicitMapping). Lets hot mapping loops write entries without a
  // per-entry setPointMapEntry() dispatch.
  get indicesMap() {
    return this._indicesMap;
  }

  // Implicit mapping: point index equals attribute entry index.
  setIdentityMapping() {
    this._identityMapping = true;
    this._indicesMap = [];
  }

  setExplicitMapping(numPoints) {
    this._identityMapping = false;
    // Uint32Array (rather than a plain Array) keeps mappedIndex() monomorphic
    // and avoids boxed-number storage; it is read once per point per attribute.
    // Must be UNSIGNED so the 0xFFFFFFFF invalid sentinel round-trips intact.
    this._indicesMap = new Uint32Array(numPoints);
    this._indicesMap.fill(kInvalidAttributeValueIndex);
  }

  setAttributeTransformData(transformData) {
    this._attributeTransformData = transformData;
  }

  // Mirrors C++ PointAttribute::ConvertValue<T>().
  convertValue(attIndex, outVal) {
    const bytePos = this._byteOffset + this._byteStride * attIndex;
    const bufData = this._buffer.data;
    const dt = this._dataType;
    const nc = this._numComponents;

    if (dt === DataType.FLOAT32) {
      if (this._cachedFloat32View === undefined || this._cachedFloat32Buffer !== bufData.buffer) {
        this._cachedFloat32Buffer = bufData.buffer;
        this._cachedFloat32View = new Float32Array(bufData.buffer);
      }
      const baseIndex = (bufData.byteOffset + bytePos) >> 2;
      for (let i = 0; i < nc; ++i) {
        outVal[i] = this._cachedFloat32View[baseIndex + i];
      }
      return;
    }

    // INT32 fast path: portable attrs are INT32, read per-corner by the
    // geometric-normal / texcoords predictors. Cached Int32Array view avoids
    // the per-component DataView dispatch (base is always 4-aligned).
    if (dt === DataType.INT32) {
      if (this._cachedInt32View === undefined || this._cachedInt32Buffer !== bufData.buffer) {
        this._cachedInt32Buffer = bufData.buffer;
        this._cachedInt32View = new Int32Array(bufData.buffer);
      }
      const baseIndex = (bufData.byteOffset + bytePos) >> 2;
      for (let i = 0; i < nc; ++i) {
        outVal[i] = this._cachedInt32View[baseIndex + i];
      }
      return;
    }

    if (dt === DataType.UINT32) {
      if (this._cachedUint32View === undefined || this._cachedUint32Buffer !== bufData.buffer) {
        this._cachedUint32Buffer = bufData.buffer;
        this._cachedUint32View = new Uint32Array(bufData.buffer);
      }
      const baseIndex = (bufData.byteOffset + bytePos) >> 2;
      for (let i = 0; i < nc; ++i) {
        outVal[i] = this._cachedUint32View[baseIndex + i];
      }
      return;
    }

    // General path: cached DataView for non-32-bit-aligned types.
    if (this._cachedDataView === undefined || this._cachedDVBuffer !== bufData.buffer) {
      this._cachedDVBuffer = bufData.buffer;
      this._cachedDataView = new DataView(bufData.buffer, bufData.byteOffset, bufData.byteLength);
    }
    const dv = this._cachedDataView;
    for (let i = 0; i < nc; ++i) {
      switch (dt) {
        case DataType.INT8:
          outVal[i] = dv.getInt8(bytePos + i); break;
        case DataType.UINT8:
          outVal[i] = dv.getUint8(bytePos + i); break;
        case DataType.INT16:
          outVal[i] = dv.getInt16(bytePos + i * 2, true); break;
        case DataType.UINT16:
          outVal[i] = dv.getUint16(bytePos + i * 2, true); break;
        case DataType.INT32:
          outVal[i] = dv.getInt32(bytePos + i * 4, true); break;
        case DataType.UINT32:
          outVal[i] = dv.getUint32(bytePos + i * 4, true); break;
        case DataType.FLOAT64:
          outVal[i] = dv.getFloat64(bytePos + i * 8, true); break;
        default:
          outVal[i] = 0; break;
      }
    }
  }

  // Flat-array extraction of all values into one output typed array (avoids the
  // per-point temp-array copy via cached typed-array views over the buffer).
  extractTo(OutputTypedArray, numPoints) {
    const numComponents = this._numComponents;
    const array = new OutputTypedArray(numPoints * numComponents);
    if (this._buffer == null || this._buffer.data == null || numPoints === 0) {
      return array;
    }
    const bufData = this._buffer.data;
    const dt = this._dataType;
    const isIdentity = this._identityMapping;
    const indicesMap = this._indicesMap;
    const byteStride = this._byteStride;
    const byteOffset = this._byteOffset;

    let srcView = null;
    let shift = 0;

    if (dt === DataType.FLOAT32) {
      if (this._cachedFloat32View === undefined || this._cachedFloat32Buffer !== bufData.buffer) {
        this._cachedFloat32Buffer = bufData.buffer;
        this._cachedFloat32View = new Float32Array(bufData.buffer);
      }
      srcView = this._cachedFloat32View;
      shift = 2;
    } else if (dt === DataType.INT32) {
      if (this._cachedInt32View === undefined || this._cachedInt32Buffer !== bufData.buffer) {
        this._cachedInt32Buffer = bufData.buffer;
        this._cachedInt32View = new Int32Array(bufData.buffer);
      }
      srcView = this._cachedInt32View;
      shift = 2;
    } else if (dt === DataType.UINT32) {
      if (this._cachedUint32View === undefined || this._cachedUint32Buffer !== bufData.buffer) {
        this._cachedUint32Buffer = bufData.buffer;
        this._cachedUint32View = new Uint32Array(bufData.buffer);
      }
      srcView = this._cachedUint32View;
      shift = 2;
    } else if (dt === DataType.UINT16) {
      if (this._cachedUint16View === undefined || this._cachedUint16Buffer !== bufData.buffer) {
        this._cachedUint16Buffer = bufData.buffer;
        this._cachedUint16View = new Uint16Array(bufData.buffer);
      }
      srcView = this._cachedUint16View;
      shift = 1;
    } else if (dt === DataType.INT16) {
      if (this._cachedInt16View === undefined || this._cachedInt16Buffer !== bufData.buffer) {
        this._cachedInt16Buffer = bufData.buffer;
        this._cachedInt16View = new Int16Array(bufData.buffer);
      }
      srcView = this._cachedInt16View;
      shift = 1;
    } else if (dt === DataType.UINT8) {
      if (this._cachedUint8View === undefined || this._cachedUint8Buffer !== bufData.buffer) {
        this._cachedUint8Buffer = bufData.buffer;
        this._cachedUint8View = new Uint8Array(bufData.buffer);
      }
      srcView = this._cachedUint8View;
      shift = 0;
    } else if (dt === DataType.INT8) {
      if (this._cachedInt8View === undefined || this._cachedInt8Buffer !== bufData.buffer) {
        this._cachedInt8Buffer = bufData.buffer;
        this._cachedInt8View = new Int8Array(bufData.buffer);
      }
      srcView = this._cachedInt8View;
      shift = 0;
    } else if (dt === DataType.FLOAT64) {
      if (this._cachedFloat64View === undefined || this._cachedFloat64Buffer !== bufData.buffer) {
        this._cachedFloat64Buffer = bufData.buffer;
        this._cachedFloat64View = new Float64Array(bufData.buffer);
      }
      srcView = this._cachedFloat64View;
      shift = 3;
    }

    if (srcView !== null) {
      const srcStart = (bufData.byteOffset + byteOffset) >> shift;
      const strideElements = byteStride >> shift;

      // Contiguous: single block copy when source and output types match.
      if (isIdentity && strideElements === numComponents) {
        const srcEnd = srcStart + numPoints * numComponents;
        if (srcView.constructor === OutputTypedArray) {
          array.set(srcView.subarray(srcStart, srcEnd));
          return array;
        }
      }

      // Branch the loop-invariant isIdentity once; unroll the nc=2/3 gather.
      if (isIdentity) {
        let dst = 0;
        for (let i = 0; i < numPoints; i++) {
          const srcOffset = srcStart + i * strideElements;
          for (let j = 0; j < numComponents; j++) {
            array[dst + j] = srcView[srcOffset + j];
          }
          dst += numComponents;
        }
      } else if (numComponents === 3) {
        let dst = 0;
        for (let i = 0; i < numPoints; i++) {
          const srcOffset = srcStart + indicesMap[i] * strideElements;
          array[dst] = srcView[srcOffset];
          array[dst + 1] = srcView[srcOffset + 1];
          array[dst + 2] = srcView[srcOffset + 2];
          dst += 3;
        }
      } else if (numComponents === 2) {
        let dst = 0;
        for (let i = 0; i < numPoints; i++) {
          const srcOffset = srcStart + indicesMap[i] * strideElements;
          array[dst] = srcView[srcOffset];
          array[dst + 1] = srcView[srcOffset + 1];
          dst += 2;
        }
      } else {
        let dst = 0;
        for (let i = 0; i < numPoints; i++) {
          const srcOffset = srcStart + indicesMap[i] * strideElements;
          for (let j = 0; j < numComponents; j++) {
            array[dst + j] = srcView[srcOffset + j];
          }
          dst += numComponents;
        }
      }
      return array;
    }

    // Fallback for any other dtype via convertValue.
    const temp = new Array(numComponents);
    for (let i = 0; i < numPoints; i++) {
      const attIndex = isIdentity ? i : indicesMap[i];
      this.convertValue(attIndex, temp);
      const dstOffset = i * numComponents;
      for (let j = 0; j < numComponents; j++) {
        array[dstOffset + j] = temp[j];
      }
    }
    return array;
  }

  copyFrom(srcAtt) {
    if (this.buffer === null) {
      this._attributeBuffer = new DataBuffer();
      this.resetBuffer(this._attributeBuffer, 0, 0);
    }
    if (!super.copyFrom(srcAtt)) {
      return;
    }
    this._identityMapping = srcAtt._identityMapping;
    this._numUniqueEntries = srcAtt._numUniqueEntries;
    this._indicesMap = srcAtt._indicesMap.slice();
    if (srcAtt._attributeTransformData) {
      // Shallow copy; transform data is normally set fresh during decode.
      this._attributeTransformData = srcAtt._attributeTransformData;
    } else {
      this._attributeTransformData = null;
    }
  }

}

export { PointAttribute };
