// compression/attributes/AttributesDecoder.js - ported from compression/attributes/attributes_decoder.h/cc

import { GeometryAttribute, GeometryAttributeType } from '../../attributes/GeometryAttribute.js';
import { PointAttribute } from '../../attributes/PointAttribute.js';
import { DataType, dataTypeLength } from '../../core/DracoTypes.js';
import { decodeVarint } from '../../core/VarintDecoding.js';

// Base class for AttributesDecoders; shared functionality for all of them.
class AttributesDecoder {

  constructor() {
    this._pointAttributeIds = [];
    // Inverse of _pointAttributeIds: point attribute id -> local id.
    this._pointAttributeToLocalIdMap = [];
    this._pointCloudDecoder = null;
    this._pointCloud = null;
  }

  init(decoder, pointCloud) {
    this._pointCloudDecoder = decoder;
    this._pointCloud = pointCloud;
    return true;
  }

  decodeAttributesDecoderData(buffer) {
    let numAttributes;

    numAttributes = decodeVarint(buffer, false);
    if (numAttributes === undefined) return false;

    if (numAttributes === 0) {
      return false;
    }
    if (numAttributes > 5 * buffer.remainingSize) {
      // Unreasonably high; reject.
      return false;
    }

    this._pointAttributeIds.length = numAttributes;
    const pc = this._pointCloud;

    for (let i = 0; i < numAttributes; i++) {
      const attType = buffer.decodeUint8();
      if (attType === undefined) return false;

      const dataType = buffer.decodeUint8();
      if (dataType === undefined) return false;

      const numComponents = buffer.decodeUint8();
      if (numComponents === undefined) return false;

      const normalized = buffer.decodeUint8();
      if (normalized === undefined) return false;

      if (attType >= GeometryAttributeType.NAMED_ATTRIBUTES_COUNT) {
        return false;
      }
      if (dataType === DataType.INVALID || dataType >= DataType.TYPES_COUNT) {
        return false;
      }

      if (numComponents === 0) {
        return false;
      }

      const ga = new GeometryAttribute();
      ga.init(
        attType, null, numComponents, dataType,
        normalized > 0,
        dataTypeLength(dataType) * numComponents, 0
      );

      const uniqueId = decodeVarint(buffer, false);
      if (uniqueId === undefined) return false;
      ga.uniqueId = uniqueId;

      const pa = new PointAttribute(ga);
      const attId = pc.addAttribute(pa);
      pc.attribute(attId).uniqueId = uniqueId;
      this._pointAttributeIds[i] = attId;

      if (attId >= this._pointAttributeToLocalIdMap.length) {
        const oldLen = this._pointAttributeToLocalIdMap.length;
        this._pointAttributeToLocalIdMap.length = attId + 1;
        for (let j = oldLen; j <= attId; j++) {
          this._pointAttributeToLocalIdMap[j] = -1;
        }
      }
      this._pointAttributeToLocalIdMap[attId] = i;
    }
    return true;
  }

  getAttributeId(i) {
    return this._pointAttributeIds[i];
  }

  getNumAttributes() {
    return this._pointAttributeIds.length;
  }

  getDecoder() {
    return this._pointCloudDecoder;
  }

  decodeAttributes(buffer) {
    if (!this.decodePortableAttributes(buffer)) {
      return false;
    }
    if (!this.decodeDataNeededByPortableTransforms(buffer)) {
      return false;
    }
    if (!this.transformAttributesToOriginalFormat()) {
      return false;
    }
    return true;
  }

  getLocalIdForPointAttribute(pointAttributeId) {
    if (pointAttributeId >= this._pointAttributeToLocalIdMap.length) {
      return -1;
    }
    return this._pointAttributeToLocalIdMap[pointAttributeId];
  }

}

export { AttributesDecoder };
