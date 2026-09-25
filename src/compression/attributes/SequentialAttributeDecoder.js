// compression/attributes/SequentialAttributeDecoder.js - ported from compression/attributes/sequential_attribute_decoder.h/cc

import { AttributeArrays } from '../../attributes/PointAttribute.js';
import { dataTypeLength } from '../../core/DracoTypes.js';

// A base class for decoding attribute values encoded by the
// SequentialAttributeEncoder.
class SequentialAttributeDecoder {

  constructor() {
    this._decoder = null;
    this._attribute = null;
    this._attributeId = -1;
  }

  init(decoder, attributeId) {
    this._decoder = decoder;
    this._attribute = decoder.pointCloud().attribute(attributeId);
    this._attributeId = attributeId;
    return true;
  }

  decodePortableAttribute(pointIds, buffer) {
    if (this._attribute.numComponents <= 0) {
      return false;
    }
    this._attribute.size = pointIds.length;
    return this.decodeValues(pointIds, buffer);
  }

  // No-op by default; subclasses with a transform override this.
  decodeDataNeededByPortableTransform(pointIds, buffer) {
    return true;
  }

  // No-op by default; subclasses with a transform override this.
  finalizeAttribute(pointIds) {
    return true;
  }

  getPortableAttribute() {
    return this._attribute.portable ? this._attribute : null;
  }

  get attribute() {
    return this._attribute;
  }

  get attributeId() {
    return this._attributeId;
  }

  get decoder() {
    return this._decoder;
  }

  initPredictionScheme(ps) {
    for (let i = 0; i < ps.getNumParentAttributes(); i++) {
      const attId = this._decoder.pointCloud().getNamedAttributeId(
        ps.getParentAttributeType(i)
      );
      if (attId === -1) {
        return false; // Requested attribute does not exist.
      }
      const pa = this._decoder.getPortableAttribute(attId);
      if (pa === null || !ps.setParentAttribute(pa)) {
        return false;
      }
    }
    return true;
  }

  // Decodes raw attribute values in their original format.
  decodeValues(pointIds, buffer) {
    const numValues = pointIds.length;
    const attribute = this._attribute;
    const entrySize = dataTypeLength(attribute.dataType) * attribute.numComponents;
    const ArrayType = AttributeArrays[attribute.dataType];
    attribute.values = ArrayType ? new ArrayType(numValues * attribute.numComponents)
      : new Uint8Array(numValues * entrySize);
    const bytes = new Uint8Array(attribute.values.buffer);
    let outBytePos = 0;
    for (let i = 0; i < numValues; i++) {
      const valueData = buffer.decodeBytes(entrySize);
      if (valueData === undefined) {
        return false;
      }
      bytes.set(valueData, outBytePos);
      outBytePos += entrySize;
    }
    return true;
  }

}

export { SequentialAttributeDecoder };
